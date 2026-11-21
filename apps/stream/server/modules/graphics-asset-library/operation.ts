import type {
	GraphicAssetId,
	GraphicAssetRevisionId,
	GraphicsAssetLibraryCapacity,
	GraphicsIngestionOperation,
	GraphicsIngestionOperationId,
	TemplatePackageInstallationResult,
} from '~~/shared/types/graphicsAsset';
import type { InstallTemplatePackageCatalogueInput } from '.';
import { graphicsObjectIdentity } from './object-store';

/**
 * The Graphics Ingestion Operation lifecycle every pipeline runs on, whatever
 * it publishes: Graphic Asset ingestion and Template Packages share this one
 * interface rather than each declaring its own copy (ADR-0073).
 *
 * Both start an operation through `initiateGraphicsIngestion`.
 * `claimGraphicsIngestion` is what keeps one active attempt per operation: it
 * answers the operation only to the caller whose compare-and-set landed, and
 * takes a working operation only once its last write is older than
 * `staleBefore`. `updateIngestionOperation` commits against `expectedUpdatedAt`
 * and answers the authoritative row.
 */
export interface GraphicsIngestionOperationCatalogue {
	getCapacity: () => Promise<GraphicsAssetLibraryCapacity>;
	initiateGraphicsIngestion: (
		operation: GraphicsIngestionOperation,
	) => Promise<GraphicsIngestionOperation>;
	getIngestionOperation: (
		operationId: GraphicsIngestionOperationId,
		initiatedBy: string,
	) => Promise<GraphicsIngestionOperation | undefined>;
	updateIngestionOperation: (
		operation: GraphicsIngestionOperation,
		expectedUpdatedAt: string,
	) => Promise<GraphicsIngestionOperation>;
	claimGraphicsIngestion: (input: {
		operation: GraphicsIngestionOperation;
		claimedAt: string;
		staleBefore: string;
	}) => Promise<GraphicsIngestionOperation | undefined>;
	/**
	 * Holds the operation for the attempt processing it until `until`, or lets
	 * it go with `null`. A claim is refused while the lease stands.
	 */
	holdIngestionProcessingLease: (input: {
		operationId: GraphicsIngestionOperationId;
		initiatedBy: string;
		until: string | null;
		/** Letting go, the lease this attempt took: one a later attempt took is kept. */
		releasing?: string;
	}) => Promise<void>;
	recordCanonicalWrites: (input: {
		operation: GraphicsIngestionOperation;
		contents: readonly { digest: string; byteLength: number }[];
		recordedAt: string;
	}) => Promise<void>;
}

/**
 * Installation always creates a Template rather than revising one: a package
 * carries an independent copy, and installing the same package twice produces
 * two Installed Graphics Templates rather than a second revision of one. The
 * column exists because a Template's revision is managed once authors can edit
 * one in place, which is the graphics-editor work rather than this transfer.
 */
export const INSTALLED_GRAPHICS_TEMPLATE_FIRST_REVISION = 1;

/**
 * An operation nobody will hear from again: completed, cancelled, or failed
 * for good. The catalogues' `TERMINAL_STAGE_SQL` states the same rule.
 */
export function isTerminalIngestionOperation(
	operation: Pick<GraphicsIngestionOperation, 'stage' | 'failure'>,
): boolean {
	return (
		operation.stage === 'completed' ||
		operation.stage === 'cancelled' ||
		(operation.stage === 'failed' && operation.failure?.retryable === false)
	);
}

/**
 * Every staging object one Graphics Ingestion Operation may own. Cancellation,
 * terminal failure, and staged-input expiry all reclaim the same complete set.
 */
export function stagedIngestionObjectIdentities(operationId: GraphicsIngestionOperationId) {
	return [
		graphicsObjectIdentity(`ingestion/${operationId}/source`),
		graphicsObjectIdentity(`ingestion/${operationId}/video-poster`),
		// The one working copy an earlier version staged for every video.
		graphicsObjectIdentity(`ingestion/${operationId}-packaged-video/source`),
	];
}

/**
 * The staged working copy of one packaged silent video a Template Package
 * operation is validating, keyed by the video's content digest.
 *
 * The pinned validation runtime reads the whole staged source of the operation
 * it is given, and a package's staged source is the archive, not the video. So
 * each video entry is copied out under a reserved operation name of its own,
 * where the runtime reads it exactly as it reads an uploaded one. Keyed by
 * content, a copy an interrupted attempt left can only ever be read as the
 * video it holds. The copies are objects the package operation owns, under
 * `templatePackageVideoWorkingCopyPrefix`, so every release of its staged input
 * reclaims those an interrupted preflight left behind.
 */
export function templatePackageVideoWorkingCopyOperationId(
	operationId: GraphicsIngestionOperationId,
	contentDigest: string,
): GraphicsIngestionOperationId {
	return `${operationId}-packaged-video-${contentDigest}` as GraphicsIngestionOperationId;
}

/** Where every packaged-video working copy of one operation is staged. */
export function templatePackageVideoWorkingCopyPrefix(
	operationId: GraphicsIngestionOperationId,
): string {
	return `ingestion/${operationId}-packaged-video-`;
}

/**
 * What one complete Template Package installation published, in the order an
 * author reads it.
 */
export function templatePackageInstallationResult(
	input: Pick<InstallTemplatePackageCatalogueInput, 'template' | 'created' | 'reused'>,
): TemplatePackageInstallationResult {
	return {
		templateId: input.template.id,
		templateKind: input.template.kind,
		templateName: input.template.name,
		assets: [
			...input.created.map((asset) => ({
				packagedId: asset.packagedId,
				outcome: 'created' as const,
				basis: asset.basis,
				assetId: asset.assetId,
				revisionId: asset.revisionId,
				name: asset.name,
				kind: asset.kind,
				compatibilityProfile: asset.compatibilityProfile,
			})),
			...input.reused.map((asset) => ({
				packagedId: asset.packagedId,
				outcome: 'reused' as const,
				// Reuse happens for one reason only, which is why it is the mapping
				// that leaves the local asset untouched.
				basis: 'exact-origin' as const,
				assetId: asset.assetId,
				revisionId: asset.revisionId,
				name: asset.name,
				kind: asset.kind,
				compatibilityProfile: asset.compatibilityProfile,
			})),
		].sort((left, right) => left.packagedId.localeCompare(right.packagedId)),
	};
}

export function completedGraphicAssetReplacementOperation(input: {
	operation: GraphicsIngestionOperation;
	outcome: 'revision-created' | 'replacement-noop';
	assetId: GraphicAssetId;
	revisionId: GraphicAssetRevisionId;
	completedAt: string;
}): GraphicsIngestionOperation {
	return {
		...input.operation,
		stage: 'completed',
		failure: undefined,
		result: {
			outcome: input.outcome,
			assetId: input.assetId,
			revisionId: input.revisionId,
		},
		updatedAt: input.completedAt,
	};
}
