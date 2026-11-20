import type { TemplatePackageArchiveSource } from '~~/server/modules/graphics-asset-library/template-package-archive';
import { describe, expect, it } from 'vitest';
import {
	readTemplatePackageArchive,
	windowedArchiveSource,
} from '~~/server/modules/graphics-asset-library/template-package-archive';
import { crc32 } from '~~/server/modules/graphics-asset-library/zip-archive';

// The stored-ZIP reader's structural refusals, at their home. Each row builds an
// archive the exporter would never write and names the one rule that refuses it.

interface EntrySpec {
	name: string;
	bytes: Uint8Array;
	/** The name its local header carries; the central name otherwise. */
	localName?: string;
	/** The CRC its data descriptor carries; the true one otherwise. */
	descriptorCrc?: number;
	centralExtra?: Uint8Array;
	diskStart?: number;
}

interface ArchiveSpec {
	entries: EntrySpec[];
	/** Undeclared bytes written after the first entry. */
	gapAfterFirst?: Uint8Array;
	endRecordDisk?: number;
}

const encoder = new TextEncoder();

function u16(value: number) {
	const bytes = new Uint8Array(2);
	new DataView(bytes.buffer).setUint16(0, value, true);
	return bytes;
}

function u32(value: number) {
	const bytes = new Uint8Array(4);
	new DataView(bytes.buffer).setUint32(0, value, true);
	return bytes;
}

function concat(parts: Uint8Array[]) {
	const out = new Uint8Array(parts.reduce((total, part) => total + part.byteLength, 0));
	let offset = 0;
	for (const part of parts) {
		out.set(part, offset);
		offset += part.byteLength;
	}
	return out;
}

/** One entry as the exporter writes it: local header, stored bytes, data descriptor. */
function localRecord(name: string, bytes: Uint8Array, descriptorCrc = crc32(bytes)) {
	const encodedName = encoder.encode(name);
	return concat([
		u32(0x04034b50),
		u16(20),
		u16(0x0808),
		u16(0),
		u16(0),
		u16(0x0021),
		u32(0),
		u32(0),
		u32(0),
		u16(encodedName.byteLength),
		u16(0),
		encodedName,
		bytes,
		u32(0x08074b50),
		u32(descriptorCrc),
		u32(bytes.byteLength),
		u32(bytes.byteLength),
	]);
}

function centralRecord(entry: EntrySpec, localOffset: number) {
	const encodedName = encoder.encode(entry.name);
	const extra = entry.centralExtra ?? new Uint8Array();
	return concat([
		u32(0x02014b50),
		u16(20),
		u16(20),
		u16(0x0808),
		u16(0),
		u16(0),
		u16(0x0021),
		u32(crc32(entry.bytes)),
		u32(entry.bytes.byteLength),
		u32(entry.bytes.byteLength),
		u16(encodedName.byteLength),
		u16(extra.byteLength),
		u16(0),
		u16(entry.diskStart ?? 0),
		u16(0),
		u32(0),
		u32(localOffset),
		encodedName,
		extra,
	]);
}

function endRecord(input: {
	entryCount: number;
	directoryByteLength: number;
	directoryOffset: number;
	disk?: number;
}) {
	return concat([
		u32(0x06054b50),
		u16(input.disk ?? 0),
		u16(0),
		u16(input.entryCount),
		u16(input.entryCount),
		u32(input.directoryByteLength),
		u32(input.directoryOffset),
		u16(0),
	]);
}

function archive(spec: ArchiveSpec): Uint8Array {
	const body: Uint8Array[] = [];
	const offsets: number[] = [];
	let offset = 0;
	for (const [index, entry] of spec.entries.entries()) {
		offsets.push(offset);
		const record = localRecord(entry.localName ?? entry.name, entry.bytes, entry.descriptorCrc);
		body.push(record);
		offset += record.byteLength;
		if (index === 0 && spec.gapAfterFirst) {
			body.push(spec.gapAfterFirst);
			offset += spec.gapAfterFirst.byteLength;
		}
	}
	const directory = concat(
		spec.entries.map((entry, index) => centralRecord(entry, offsets[index]!)),
	);
	return concat([
		...body,
		directory,
		endRecord({
			entryCount: spec.entries.length,
			directoryByteLength: directory.byteLength,
			directoryOffset: offset,
			disk: spec.endRecordDisk,
		}),
	]);
}

function sourceOf(bytes: Uint8Array): TemplatePackageArchiveSource {
	return {
		byteLength: bytes.byteLength,
		read: async (offset, length) => bytes.slice(offset, offset + length),
	};
}

const manifest = { name: 'manifest.json', bytes: encoder.encode('{"schemaVersion":1}') };
const content = { name: 'assets/one.bin', bytes: Uint8Array.of(1, 2, 3, 4) };

/**
 * An archive whose first entry's stored bytes hold the second entry whole, so
 * the same bytes belong to two entries.
 */
function overlappingArchive() {
	const inner = localRecord(content.name, content.bytes);
	const outer = { name: manifest.name, bytes: inner };
	const outerRecord = localRecord(outer.name, outer.bytes);
	const innerOffset = 30 + encoder.encode(outer.name).byteLength;
	const directory = concat([centralRecord(outer, 0), centralRecord(content, innerOffset)]);
	return concat([
		outerRecord,
		directory,
		endRecord({
			entryCount: 2,
			directoryByteLength: directory.byteLength,
			directoryOffset: outerRecord.byteLength,
		}),
	]);
}

/** An end record claiming a central directory larger than any package's can be. */
function oversizedDirectoryArchive() {
	const directoryByteLength = 128 * (46 + 200) + 1;
	return concat([
		new Uint8Array(directoryByteLength),
		endRecord({ entryCount: 1, directoryByteLength, directoryOffset: 0 }),
	]);
}

describe('reading a Template Package archive', () => {
	it('reads a well-formed archive into its entries', async () => {
		const read = await readTemplatePackageArchive(
			sourceOf(archive({ entries: [manifest, content] })),
		);

		expect(read).toMatchObject({
			outcome: 'read',
			entries: [
				{ name: manifest.name, byteLength: manifest.bytes.byteLength },
				{ name: content.name, byteLength: 4, crc32: crc32(content.bytes) },
			],
		});
	});

	it.each([
		{
			archive: 'overlapping entries',
			bytes: overlappingArchive(),
			code: 'undeclared-package-entry',
		},
		{
			archive: 'a gap between entries',
			bytes: archive({ entries: [manifest, content], gapAfterFirst: Uint8Array.of(9, 9) }),
			code: 'undeclared-package-entry',
		},
		{
			archive: 'a data descriptor disagreeing with the central directory',
			bytes: archive({ entries: [manifest, { ...content, descriptorCrc: 1 }] }),
			code: 'malformed-package-archive',
			message: /data descriptor/,
		},
		{
			archive: 'a central-directory extra field',
			bytes: archive({ entries: [{ ...manifest, centralExtra: Uint8Array.of(1, 0, 0, 0) }] }),
			code: 'malformed-package-archive',
			message: /extra field/,
		},
		{
			archive: 'an entry on another disk',
			bytes: archive({ entries: [{ ...manifest, diskStart: 1 }] }),
			code: 'malformed-package-archive',
			message: /another disk/,
		},
		{
			archive: 'an end record split across disks',
			bytes: archive({ entries: [manifest], endRecordDisk: 1 }),
			code: 'malformed-package-archive',
			message: /split across disks/,
		},
		{
			archive: 'an oversized central directory',
			bytes: oversizedDirectoryArchive(),
			code: 'malformed-package-archive',
			message: /central directory does not end/,
		},
		{
			archive: 'a local name differing from the central one',
			bytes: archive({ entries: [{ ...manifest, localName: 'manifest.jsoN' }] }),
			code: 'malformed-package-archive',
			message: /local header name/,
		},
		{
			archive: 'zero entries',
			bytes: archive({ entries: [] }),
			code: 'malformed-package-archive',
			message: /declares no entries/,
		},
	])('refuses $archive', async ({ bytes, code, message }) => {
		const read = await readTemplatePackageArchive(sourceOf(bytes));

		expect(read.outcome).toBe('rejected');
		if (read.outcome !== 'rejected') return;
		expect(read.issues).toEqual([
			expect.objectContaining({
				code,
				...(message ? { message: expect.stringMatching(message) } : {}),
			}),
		]);
	});
});

describe('windowedArchiveSource', () => {
	// Small reads near each other cost one staging read: the archive's headers,
	// names and descriptors sit together, and an entry streams in chunks.
	it('serves reads within one window from a single read of the source', async () => {
		const bytes = Uint8Array.from({ length: 100 }, (_, index) => index);
		const reads: [number, number][] = [];
		const windowed = windowedArchiveSource(
			{
				byteLength: bytes.byteLength,
				read: async (offset, length) => {
					reads.push([offset, length]);
					return bytes.slice(offset, offset + length);
				},
			},
			40,
		);

		expect(await windowed.read(0, 10)).toEqual(bytes.slice(0, 10));
		expect(await windowed.read(30, 10)).toEqual(bytes.slice(30, 40));
		expect(await windowed.read(35, 10)).toEqual(bytes.slice(35, 45));
		expect(await windowed.read(90, 10)).toEqual(bytes.slice(90, 100));
		expect(await windowed.read(0, 60)).toEqual(bytes.slice(0, 60));

		expect(reads).toEqual([
			[0, 40],
			[35, 40],
			[60, 40],
			[0, 60],
		]);
	});
});
