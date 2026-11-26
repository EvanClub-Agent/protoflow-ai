import { appearanceSpecs, frameSpecs, isAxureMaterial, positionedNativeTypes } from '../axure/metadata';
import { isFigmaMaterial } from '../figma/metadata';
import {
  COMPONENTS,
  DESKTOP_OVERLAY_TYPES,
  FIELD_TYPES,
  MOBILE_COMPONENT_NAMES,
  MOBILE_OVERLAY_TYPES,
  OVERLAY_TYPES,
  PAGE_ROOT_TYPES,
  type ComponentMeta,
  type PropSpec,
} from './meta';
import { isChartType } from '../charts/model';

/** Serializable value contracts shared by AI discovery and both validation gates. */
export interface ValueSchema {
  type?: 'string' | 'number' | 'boolean' | 'null' | 'array' | 'object' | 'actions';
  enum?: (string | number | boolean)[];
  anyOf?: ValueSchema[];
  properties?: Record<string, ValueSchema>;
  required?: string[];
  additionalProperties?: boolean | ValueSchema;
  items?: ValueSchema;
  minimum?: number;
  maximum?: number;
  integer?: boolean;
  minLength?: number;
  $ref?: string;
}

const string: ValueSchema = { type: 'string' };
const number: ValueSchema = { type: 'number' };
const boolean: ValueSchema = { type: 'boolean' };
const scalar: ValueSchema = { anyOf: [string, number, boolean, { type: 'null' }] };
const enumeration = (...values: string[]): ValueSchema => ({ type: 'string', enum: values });
const object = (properties: Record<string, ValueSchema>, required: string[] = []): ValueSchema => ({ type: 'object', properties, required, additionalProperties: false });
const optionValue: ValueSchema = { anyOf: [string, number] };
const option = object({ label: string, value: optionValue, disabled: boolean }, ['label', 'value']);
export const MATERIAL_VALUE_DEFINITIONS: Record<string, ValueSchema> = {
  freeformJson: { anyOf: [scalar, { type: 'array', items: { $ref: 'freeformJson' } }, { type: 'object', additionalProperties: { $ref: 'freeformJson' } }] },
  treeOption: object({ label: string, value: optionValue, disabled: boolean, children: { type: 'array', items: { $ref: 'treeOption' } } }, ['label', 'value']),
};

export const COMMON_LAYOUT_PROPS: PropSpec[] = [
  { name: 'width', label: '画布占宽', kind: 'select', options: ['auto', '1/4', '1/3', '1/2', '2/3', '3/4', 'full'], description: '画布布局占宽，不是 CSS 像素宽度；Modal/Drawer 使用自己的数值 width。' },
];
const controlWidth: PropSpec = { name: 'controlWidth', label: '行内控件宽度', kind: 'select', options: ['sm', 'md', 'lg'] };

export function materialPropSpecs(component: ComponentMeta): PropSpec[] {
  const isMobile = MOBILE_COMPONENT_NAMES.has(component.name);
  const isFigma = isFigmaMaterial(component.name);
  return [...component.props,
    ...(positionedNativeTypes.has(component.name) ? [{ name: 'layoutFrame', label: '自由定位与外观', kind: 'json' as const }] : []),
    ...(PAGE_ROOT_TYPES.has(component.name) || isMobile || isFigma || OVERLAY_TYPES.has(component.name) ? [] : COMMON_LAYOUT_PROPS.filter((p) => !component.props.some((own) => own.name === p.name))),
    ...(FIELD_TYPES.has(component.name) && !isMobile ? [controlWidth] : []),
  ];
}

export const FIELD_COMPONENT_NAMES: Record<string, string> = {
  input: 'Input', number: 'NumberInput', textarea: 'Textarea', select: 'Select', date: 'DatePicker', dateRange: 'DateRange', radio: 'Radio', checkbox: 'Checkbox', switch: 'Switch', upload: 'Upload', picker: 'PickerInput',
  time: 'TimePicker', slider: 'Slider', rate: 'Rate', cascader: 'Cascader', treeSelect: 'TreeSelect', autoComplete: 'AutoComplete', segmented: 'Segmented',
};

function fieldListSchema(owner: string): ValueSchema {
  return { type: 'array', items: { anyOf: Object.entries(FIELD_COMPONENT_NAMES).map(([kind, name]) => {
    const component = COMPONENTS.find((c) => c.name === name)!;
    // Query conditions occupy one cell; canvas width/span do not control these fields.
    const props = materialPropSpecs(component).filter((p) => owner !== 'QueryForm' || !['required', 'span', 'width'].includes(p.name));
    const properties: Record<string, ValueSchema> = Object.fromEntries(props.map((p) => [p.name, materialPropSchema(component, p)]));
    for (const event of component.events ?? []) properties[event.name] = { type: 'actions' };
    properties.type = enumeration(kind);
    return object(properties, kind === 'input' ? ['name'] : ['name', 'type']);
  }) } };
}

const positiveInteger = { type: 'number', minimum: 1, integer: true } satisfies ValueSchema;
const nonnegativeInteger = { type: 'number', minimum: 0, integer: true } satisfies ValueSchema;
const numericBounds: Record<string, ValueSchema> = {
  cols: { ...positiveInteger, maximum: 4 }, level: { ...positiveInteger, maximum: 5 },
  precision: { ...nonnegativeInteger, maximum: 100 }, percent: { type: 'number', minimum: 0, maximum: 100 },
  pageSize: positiveInteger, total: nonnegativeInteger, current: nonnegativeInteger,
  rows: positiveInteger, minRows: positiveInteger, maxRows: positiveInteger,
  maxLength: nonnegativeInteger, maxTagCount: nonnegativeInteger, maxCount: positiveInteger,
  count: nonnegativeInteger, overflowCount: nonnegativeInteger, steps: positiveInteger,
  hourStep: { ...positiveInteger, maximum: 23 }, minuteStep: { ...positiveInteger, maximum: 59 }, secondStep: { ...positiveInteger, maximum: 59 },
  column: positiveInteger, scrollX: positiveInteger, scrollY: positiveInteger, imageWidth: positiveInteger, imageHeight: positiveInteger,
  gutter: { type: 'number', minimum: 0 }, gap: { type: 'number', minimum: 0 }, labelWidth: { type: 'number', minimum: 0 },
  step: { type: 'number', minimum: Number.MIN_VALUE },
  controlMaxWidth: positiveInteger, rangeMaxWidth: positiveInteger,
};

export function materialPropSchema(component: ComponentMeta, prop: PropSpec): ValueSchema {
  if (isChartType(component.name)) {
    if (prop.name === 'data') return { type: 'array', items: { type: 'object', additionalProperties: scalar } };
    if (prop.name === 'metrics') return { type: 'array', items: object({ field: { type: 'string', minLength: 1 }, label: { type: 'string', minLength: 1 } }, ['field', 'label']) };
    if (prop.name === 'height') return { type: 'number', minimum: 180, maximum: 1200, integer: true };
  }
  if (prop.name === 'layoutFrame' || (component.name === 'StaticTable' && prop.name === 'cellStyle')) {
    const specs = prop.name === 'cellStyle' ? appearanceSpecs : [...frameSpecs, ...appearanceSpecs];
    const fields = Object.fromEntries(specs.map(p => [p.name, p.kind === 'number' ? number : p.kind === 'boolean' ? boolean : string]));
    if (prop.name === 'layoutFrame') fields.literalContent = boolean;
    return object(fields);
  }
  if (isAxureMaterial(component.name) && prop.name === 'runs') return { type: 'array', items: object({ text: string, color: string, fontSize: number, fontWeight: number, fontFamily: string }, ['text']) };
  if (component.name === 'FigmaText' && prop.name === 'runs') {
    return {
      type: 'array',
      items: object(
        { text: string, color: string, fontSize: number, fontWeight: number, fontFamily: string, italic: boolean, underline: boolean, lineThrough: boolean },
        ['text'],
      ),
    };
  }
  if (component.name === 'FigmaVector' && prop.name === 'paths') {
    return {
      type: 'array',
      items: object(
        { d: string, fill: string, stroke: string, strokeWidth: number, fillRule: enumeration('nonzero', 'evenodd') },
        ['d'],
      ),
    };
  }
  if (component.name === 'StaticTable' && ['columnWidths', 'rowHeights'].includes(prop.name)) return { type: 'array', items: { type: 'number', minimum: 0 } };
  if (isAxureMaterial(component.name) && prop.name === 'selectedOptions') return { type: 'array', items: nonnegativeInteger };
  if (component.name === 'Table' && prop.name === 'cellMerges') {
    const names: ValueSchema = { type: 'array', items: { type: 'string', minLength: 1 } };
    return { type: 'array', items: object({ rowIds: names, fields: names }, ['rowIds', 'fields']) };
  }
  if (component.name === 'Freeform') {
    if (prop.name === 'data') return { type: 'object', additionalProperties: { $ref: 'freeformJson' } };
    if (prop.name === 'height') return { type: 'number', integer: true, minimum: 80, maximum: 4000 };
    if (prop.name === 'columns') return { type: 'array', items: { type: 'string', minLength: 1 } };
    if (prop.name === 'eventFields') return { type: 'array', items: object({ name: { type: 'string', minLength: 1 }, type: enumeration('string', 'number', 'boolean') }, ['name', 'type']) };
  }
  if (prop.name === 'fields' && ['Form', 'QueryForm'].includes(component.name)) return fieldListSchema(component.name);
  if (prop.name === 'value' && component.name === 'Statistic') return optionValue;
  if (prop.name === 'span') return { ...positiveInteger, maximum: component.name === 'Col' ? 24 : 4 };
  if (prop.name === 'size' && (component.name === 'Avatar' || component.name === 'Icon')) return positiveInteger;
  if (prop.name === 'height' && (component.name === 'Carousel' || component.name === 'MBannerCarousel')) return { type: 'number', integer: true, minimum: 100, maximum: 640 };
  if (prop.name === 'width' && OVERLAY_TYPES.has(component.name)) return positiveInteger;
  if (prop.name === 'count' && component.name === 'Rate') return positiveInteger;
  if (prop.name === 'options' || (component.name === 'Table' && prop.name === 'editorOptions')) {
    if (['TreeSelect', 'Cascader'].includes(component.name)) return { type: 'array', items: { $ref: 'treeOption' } };
    const item = component.name === 'AutoComplete' ? object({ label: string, value: string, disabled: boolean }, ['label', 'value']) : option;
    return { anyOf: [string, { type: 'array', items: { anyOf: [string, ...(component.name === 'AutoComplete' ? [] : [number]), item] } }] };
  }
  if (prop.kind === 'json') {
    if (prop.name === 'filter') return { type: 'object', additionalProperties: scalar };
    throw new Error(`物料 ${component.name}.${prop.name} 缺少结构化值契约`);
  }
  if (prop.kind === 'list') {
    if (!prop.itemFields) return { type: 'array', items: string };
    const properties = Object.fromEntries(prop.itemFields.map((field) => [field.name,
      field.kind === 'actions' ? { type: 'actions' } as ValueSchema : materialPropSchema(component, field as PropSpec),
    ]));
    if (prop.name === 'items' && component.name === 'Descriptions') properties.value = optionValue;
    const required =
      prop.name === 'columns' || (component.name === 'MTaskList' && prop.name === 'fields')
        ? ['dataIndex', 'title']
        : prop.name === 'rowActions'
        ? ['label']
        : component.name === 'Descriptions' || component.name === 'MProgressList' || component.name === 'ProgressBoard'
        ? ['label']
        : ['title'];
    return { type: 'array', items: object(properties, required) };
  }
  if (prop.kind === 'select') return { type: 'string', enum: prop.options };
  if (prop.kind === 'number') return numericBounds[prop.name] ?? number;
  if (prop.kind === 'boolean') return boolean;
  return { ...string, ...(['table', 'column', 'overlay', 'page', 'nodeRef'].includes(prop.kind) || prop.required ? { minLength: 1 } : {}) };
}

export function getMaterialContracts() {
  return COMPONENTS.map((component) => ({
    ...component,
    ...(DESKTOP_OVERLAY_TYPES.has(component.name) ? { parents: ['Page'] } : {}),
    ...(MOBILE_OVERLAY_TYPES.has(component.name) ? { parents: ['MobilePage'] } : {}),
    childTypes: ({ OutlineTree: ['TreeItem'], TreeItem: ['TreeItem'], DynamicPanel: ['PanelState'], StaticTable: ['StaticTableCell'], Tabs: ['Tab'], MPillTabs: ['MTab'], Collapse: ['CollapsePanel'], Row: ['Col'] } as Record<string, string[]>)[component.name],
    props: materialPropSpecs(component).map((prop) => ({ ...prop, valueSchema: materialPropSchema(component, prop) })),
    events: (component.events ?? []).map((event) => ({ ...event, valueSchema: { type: 'actions' as const } })),
    additionalProperties: false,
  }));
}
