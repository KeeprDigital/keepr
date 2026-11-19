/** What regenerating a Screen Output Asset Capability answers (`POST …/asset-capability`). */
export interface ScreenOutputCapabilityRegeneration {
	assetCapability: string;
	/** False when the Screen's realtime sockets could not be closed (ADR-0142). */
	outputsClosed: boolean;
}

/**
 * What an Operator is told once a capability is regenerated. The regeneration
 * stood either way. When the Screen's outputs could not be disconnected, the
 * ones opened from earlier URLs still follow the Screen until they drop, and
 * only the Operator can close them, by doing it again: so it is a warning that
 * says so, not the success it would otherwise read as.
 */
export function screenOutputCapabilityRegenerationNotice(
	regeneration: Pick<ScreenOutputCapabilityRegeneration, 'outputsClosed'>,
) {
	if (regeneration.outputsClosed)
		return {
			title: 'Asset Access Rotated',
			description: 'Previously copied Screen URLs can no longer resolve Graphic Assets.',
			color: 'success',
		} as const;
	return {
		title: 'Asset Access Rotated, Outputs Still Connected',
		description:
			'Screen Outputs opened from previously copied URLs could not be disconnected. They resolve no Graphic Assets, but may follow this Screen until they are closed. Rotate asset access again to disconnect them.',
		color: 'warning',
	} as const;
}
