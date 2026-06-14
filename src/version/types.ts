export type VersionStage = string;

export interface VersionEntry {
	id: string;
	name: string;
	timestamp: number;
	charCount: number;       // 공백·줄바꿈 제외 (노벨피아)
	charCountTotal?: number; // 줄바꿈 제외, 공백 포함 (문피아)
	fileName: string;
	description?: string;
	stage?: VersionStage;
	pinned?: boolean;
}

export interface VersionManifest {
	filePath: string;
	versions: VersionEntry[];
}
