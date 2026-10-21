export interface ManuscriptSnapshot {
	id: string;
	name: string;
	timestamp: number;
	fileName: string;
	charCount: number;
	charCountTotal?: number;
	description?: string;
	stage?: string;
	/** Project plot status ID. stage retains the last known name for older records. */
	statusId?: string;
	pinned?: boolean;
	backup?: boolean;
}
/** The on-disk shape stays compatible with existing manuscript records. */
export interface ManuscriptSnapshotManifest { filePath: string; versions: ManuscriptSnapshot[] }
