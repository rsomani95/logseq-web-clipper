// Pure helper used by the "Copy markdown" / "Save .md file" secondary actions
// (kept for portable markdown export). YAML frontmatter is a generic Markdown
// convention — Logseq itself doesn't use it. Filename retained for upstream
// merge compatibility.

import { generateFrontmatter as generateFrontmatterCore } from './shared';
import { Property } from '../types/types';
import { generalSettings } from './storage-utils';

export async function generateFrontmatter(properties: Property[]): Promise<string> {
	const typeMap: Record<string, string> = {};
	for (const pt of generalSettings.propertyTypes) {
		typeMap[pt.name] = pt.type;
	}
	return generateFrontmatterCore(properties, typeMap);
}
