import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse as parseYaml } from 'yaml';
import { z } from 'zod';

export const OPERATORS = ['wave', 'orange_money'] as const;
export type Operator = (typeof OPERATORS)[number];
export type ProofKind = 'sms' | 'capture';
export type FieldName = 'amount' | 'ref' | 'datetime' | 'sender';

const formatSchema = z.object({
  id: z.string().min(3),
  operator: z.enum(OPERATORS),
  kind: z.enum(['sms', 'capture']),
  example: z.boolean().default(false),
  detect: z.array(z.string()).min(1),
  fields: z.object({
    amount: z.string(),
    ref: z.string(),
    datetime: z.string().optional(),
    sender: z.string().optional(),
  }),
  required: z
    .array(z.enum(['amount', 'ref', 'datetime', 'sender']))
    .default(['amount', 'ref']),
});

export interface ProofFormat {
  id: string;
  operator: Operator;
  kind: ProofKind;
  example: boolean;
  detect: RegExp[];
  fields: Partial<Record<FieldName, RegExp>>;
  required: FieldName[];
}

function compile(pattern: string, where: string): RegExp {
  try {
    return new RegExp(pattern, 'iu');
  } catch (err) {
    throw new Error(
      `Expression invalide (${where}) : ${(err as Error).message}`,
    );
  }
}

export function compileFormat(raw: unknown, source = 'format'): ProofFormat {
  const parsed = formatSchema.safeParse(raw);
  if (!parsed.success) {
    throw new Error(
      `Format invalide dans ${source} : ${parsed.error.issues
        .map((i) => `${i.path.join('.')} ${i.message}`)
        .join(', ')}`,
    );
  }
  const f = parsed.data;
  const fields: ProofFormat['fields'] = {};
  for (const [name, pattern] of Object.entries(f.fields)) {
    if (pattern)
      fields[name as FieldName] = compile(pattern, `${f.id}.${name}`);
  }
  return {
    id: f.id,
    operator: f.operator,
    kind: f.kind,
    example: f.example,
    detect: f.detect.map((p, i) => compile(p, `${f.id}.detect[${i}]`)),
    fields,
    required: f.required,
  };
}

/** Charge tous les *.yaml d'un dossier ; un fichier invalide bloque le démarrage. */
export function loadFormats(dir: string): ProofFormat[] {
  const files = readdirSync(dir).filter((f) => /\.ya?ml$/i.test(f));
  const formats = files.map((file) =>
    compileFormat(parseYaml(readFileSync(join(dir, file), 'utf8')), file),
  );
  const ids = new Set<string>();
  for (const f of formats) {
    if (ids.has(f.id))
      throw new Error(`Identifiant de format en double : ${f.id}`);
    ids.add(f.id);
  }
  return formats;
}
