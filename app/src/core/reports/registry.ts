import { BUNDLED_TEMPLATES } from './bundled-templates';
import { parseTemplate, type ReportTemplate } from './template';

export interface TemplateEntry {
  template: ReportTemplate;
  source: 'bundled' | 'imported';
  /** Raw YAML, kept so imported templates can be persisted and re-validated. */
  yaml: string;
}

let bundledCache: TemplateEntry[] | null = null;

/** Templates shipped with the app (from /templates in the repository). */
export function bundledTemplates(): TemplateEntry[] {
  if (!bundledCache) {
    bundledCache = Object.values(BUNDLED_TEMPLATES).map((yaml) => ({ template: parseTemplate(yaml), source: 'bundled' as const, yaml }));
  }
  return bundledCache;
}

/** Bundled templates plus imported ones; imported templates override bundled ones with the same id. */
export function allTemplates(importedYaml: string[]): TemplateEntry[] {
  const byId = new Map<string, TemplateEntry>();
  for (const e of bundledTemplates()) byId.set(e.template.id, e);
  for (const yaml of importedYaml) {
    try {
      const template = parseTemplate(yaml);
      byId.set(template.id, { template, source: 'imported', yaml });
    } catch {
      // A stored template that no longer validates is skipped rather than crashing the app.
    }
  }
  // Imported (state-specific) templates first, worked examples last.
  const rank = (e: TemplateEntry) => (e.source === 'imported' ? 0 : e.template.id.startsWith('example') ? 2 : 1);
  return Array.from(byId.values()).sort((a, b) => rank(a) - rank(b) || a.template.name.localeCompare(b.template.name));
}
