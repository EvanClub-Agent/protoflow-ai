import {
  getActionContracts,
  getMaterialContracts,
  MATERIAL_CONTRACT_VERSION,
  MATERIAL_VALUE_DEFINITIONS,
} from '../proto/registry/materialContract';
import type { ActionSpec } from '../proto/runtime/actions';
import { MCP_TOOL_CATALOGS } from './protocol';
import type { McpToolDefinition } from './tools';

const schemaMaps = new Set(['properties', 'patternProperties', '$defs', 'definitions', 'dependentSchemas', 'dependencies']);
const subschemas = new Set([
  'additionalProperties', 'unevaluatedProperties', 'propertyNames', 'items', 'additionalItems',
  'unevaluatedItems', 'prefixItems', 'contains', 'allOf', 'anyOf', 'oneOf', 'not', 'if', 'then', 'else', 'contentSchema',
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function sortedMap<T, R>(record: Record<string, T>, visit: (value: T) => R): Record<string, R> {
  return Object.fromEntries(Object.keys(record).sort().map(key => [key, visit(record[key])]));
}

// Literal JSON (e.g. const, enum or default) can contain arbitrary business keys.
function canonicalizeJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalizeJson);
  return isRecord(value) ? sortedMap(value, canonicalizeJson) : value;
}

export function canonicalizeJsonSchema(schema: unknown): unknown {
  if (Array.isArray(schema)) return schema.map(canonicalizeJsonSchema);
  if (!isRecord(schema)) return schema;
  const entries: [string, unknown][] = [];
  for (const key of Object.keys(schema).sort()) {
    if (key === 'title' || key === 'description') continue;
    const value = schema[key];
    if (schemaMaps.has(key) && isRecord(value)) {
      entries.push([key, sortedMap(value, canonicalizeJsonSchema)]);
    } else if (subschemas.has(key)) {
      entries.push([key, canonicalizeJsonSchema(value)]);
    } else if (key === 'required' && Array.isArray(value)) {
      entries.push([key, [...value].sort()]);
    } else {
      entries.push([key, canonicalizeJson(value)]);
    }
  }
  return Object.fromEntries(entries);
}

// Compare UTF-16 code units, independent of the build machine's locale or ICU data.
function compareNames(a: { name: string }, b: { name: string }): number {
  return a.name < b.name ? -1 : a.name > b.name ? 1 : 0;
}

type ToolCatalogs = Record<keyof typeof MCP_TOOL_CATALOGS, readonly Pick<McpToolDefinition, 'name' | 'inputSchema'>[]>;

export interface ContractSurfaceInputs {
  materialContractVersion?: number;
  valueDefinitions?: Record<string, unknown>;
  toolCatalogs?: ToolCatalogs;
  materials?: ReturnType<typeof getMaterialContracts>;
  actions?: readonly ActionSpec[];
}

export function buildCanonicalContractSurface(inputs: ContractSurfaceInputs = {}) {
  const materialContractVersion = inputs.materialContractVersion ?? MATERIAL_CONTRACT_VERSION;
  const valueDefinitions = inputs.valueDefinitions ?? MATERIAL_VALUE_DEFINITIONS;
  const catalogs = inputs.toolCatalogs ?? MCP_TOOL_CATALOGS;
  const materials = inputs.materials ?? getMaterialContracts();
  const actions = inputs.actions ?? getActionContracts();

  return {
    materialContractVersion,
    valueDefinitions: sortedMap(valueDefinitions, canonicalizeJsonSchema),
    tools: sortedMap(catalogs, tools => [...tools].sort(compareNames).map(tool => ({
      name: tool.name,
      inputSchema: canonicalizeJsonSchema(tool.inputSchema),
    }))),
    materials: [...materials]
      .sort(compareNames)
      .map((m) => ({
        name: m.name,
        platform: m.platform,
        category: m.category,
        container: Boolean(m.container),
        textChild: Boolean(m.textChild),
        inline: Boolean(m.inline),
        parents: m.parents ? [...m.parents] : null,
        childTypes: m.childTypes ? [...m.childTypes] : null,
        additionalProperties: m.additionalProperties,
        props: [...m.props]
          .sort(compareNames)
          .map((p) => ({
            name: p.name,
            kind: p.kind,
            ...(p.default === undefined ? {} : { default: canonicalizeJson(p.default) }),
            required: Boolean(p.required),
            options: p.options ? [...p.options] : null,
            refTypes: p.refTypes ? [...p.refTypes] : null,
            valueSchema: canonicalizeJsonSchema(p.valueSchema),
          })),
        events: [...m.events]
          .sort(compareNames)
          .map((e) => ({
            name: e.name,
            valueSchema: canonicalizeJsonSchema(e.valueSchema),
          })),
      })),
    actions: [...actions]
      .sort(compareNames)
      .map((a) => ({
        name: a.name,
        canAbort: Boolean(a.canAbort),
        args: a.args.map((arg) => ({
          name: arg.name,
          kind: arg.kind,
          optional: Boolean(arg.optional),
          options: arg.options ? [...arg.options] : null,
          refTypes: arg.refTypes ? [...arg.refTypes] : null,
        })),
      })),
  };
}
