import { resolveResearchEntities, type ResearchEntity } from './RagResearch';
export { collectRelationshipEvidence } from './RagRelationshipSelection';

export const isRelationshipResearch = (question: string) => /관계(?!없이|없다|없는)|사이|친구|친해|친한|갈등|악연|동맹|우호|적대|\b(?:relationship|bond|friends|rivalry)\b/i.test(question);

/** Only explicit names/aliases identify targets. Co-occurrence never asserts a relationship. */
export function relationshipTargets(entities: ResearchEntity[], question: string, previous = ''): ResearchEntity[] {
	if (!isRelationshipResearch(question)) return [];
	let targets = resolveResearchEntities(entities, question);
	const pair = /(?:^|\s)([\p{L}\p{N}_·.-]{1,60}?)(?:와|과|랑|하고|\s*[,·&]\s*|\s+and\s+)\s*([\p{L}\p{N}_·.-]{1,60}?)(?:의\s*|\s+)(?:관계|사이|relationship|bond)/iu.exec(question);
	if (pair) for (const name of pair.slice(1, 3)) {
		const known = resolveResearchEntities(entities, name);
		if (known.length) { for (const entity of known) if (!targets.some(target => target.id === entity.id)) targets.push(entity); }
		else if (!/^(그|이|저|둘|두|그녀|인물|주인공|서로)$/.test(name)) targets.push({ id: `literal:${encodeURIComponent(name)}`, path: '', name, aliases: [name] });
	}
	// A newly named single character must not accidentally inherit a previous pair.
	if (!targets.length && /둘|두 사람|그들|둘의|그 관계|그 사이/.test(question)) targets = resolveResearchEntities(entities, previous);
	return targets.length >= 2 ? targets : [];
}
