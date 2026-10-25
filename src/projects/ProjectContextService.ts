import { wmT } from '../i18n/index';
import { normalizePath, type TFile } from 'obsidian';
import type WritingMenuPlugin from '../../main';
import type { WritingProject } from '../types';

function normalizeFolder(path: string): string {
	return normalizePath(path.trim()).replace(/^\/+|\/+$/g, '');
}

function isPluginStoragePath(path: string): boolean {
	// 플롯과 내부 백업은 프로젝트 통계 범위 안에 있어도 원고로 집계하지 않는다.
	return normalizeFolder(path).split('/').includes('.writing-menu');
}

function isInside(path: string, folder: string): boolean {
	const normalizedPath = normalizePath(path).replace(/^\/+/, '');
	const normalizedFolder = normalizeFolder(folder);
	return !normalizedFolder
		|| normalizedPath === normalizedFolder
		|| normalizedPath.startsWith(`${normalizedFolder}/`);
}

export class ProjectContextService {
	constructor(private readonly plugin: WritingMenuPlugin) {}

	getProjects(): WritingProject[] {
		return this.plugin.settings.projects ?? [];
	}

	createProject(rootFolder: string, name?: string): WritingProject {
		const normalizedRoot = normalizeFolder(rootFolder);
		const fallbackName = normalizedRoot.split('/').pop() || wmT('프로젝트');
		return {
			id: `project-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
			name: name?.trim() || fallbackName,
			rootFolder: normalizedRoot,
			manuscriptFolder: normalizeFolder(normalizedRoot ? wmT('{0}/본문', normalizedRoot) : wmT('본문')),
			characterFolder: normalizeFolder(normalizedRoot ? wmT('{0}/인물', normalizedRoot) : wmT('인물')),
			statisticsEnabled: true,
			statisticsFolders: [],
			statisticsExcludeFolders: [],
		};
	}

	getProjectForPath(path: string): WritingProject | null {
		return this.getProjects()
			.filter(project => isInside(path, project.rootFolder))
			.sort((left, right) => normalizeFolder(right.rootFolder).length - normalizeFolder(left.rootFolder).length)[0]
			?? null;
	}

	getProjectForFile(file: TFile | null): WritingProject | null {
		return file ? this.getProjectForPath(file.path) : null;
	}

	getStatisticsProjectForPath(path: string): WritingProject | null {
		if (isPluginStoragePath(path)) return null;
		const project = this.getProjectForPath(path);
		return project && this.isInsideProjectStatisticsScope(path, project) ? project : null;
	}

	isInStatisticsScope(path: string): boolean {
		if (isPluginStoragePath(path)) return false;
		if (!this.plugin.settings.restrictStatisticsToProjects) return true;
		return this.getStatisticsProjectForPath(path) !== null;
	}

	getStatisticsScopeSignature(): string {
		if (!this.plugin.settings.restrictStatisticsToProjects) return '*';
		return this.getProjects()
			.map(project => [
				project.id,
				project.statisticsEnabled ? '1' : '0',
				normalizeFolder(project.rootFolder),
				...(project.statisticsFolders ?? []).map(normalizeFolder).sort(),
				'!',
				...(project.statisticsExcludeFolders ?? []).map(normalizeFolder).sort(),
			].join('|'))
			.sort()
			.join('::');
	}

	private isInsideProjectStatisticsScope(path: string, project: WritingProject): boolean {
		if (!project.statisticsEnabled || !isInside(path, project.rootFolder)) return false;
		const configuredScopes = (project.statisticsFolders ?? [])
			.map(normalizeFolder)
			.filter(Boolean);
		if (configuredScopes.length > 0) {
			const included = configuredScopes.some(folder =>
				isInside(folder, project.rootFolder) && isInside(path, folder));
			if (!included) return false;
		}
		const excludes = (project.statisticsExcludeFolders ?? [])
			.map(normalizeFolder)
			.filter(Boolean);
		return !excludes.some(folder => isInside(path, folder));
	}
}
