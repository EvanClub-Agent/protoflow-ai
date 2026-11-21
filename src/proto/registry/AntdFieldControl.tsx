import React from 'react';
import { positionedStyle } from '../axure/materials';
import Input from 'antd/es/input';
import InputNumber from 'antd/es/input-number';
import Select from 'antd/es/select';
import Radio from 'antd/es/radio';
import Checkbox from 'antd/es/checkbox';
import Switch from 'antd/es/switch';
import DatePicker from 'antd/es/date-picker';
import TimePicker, { type TimePickerProps } from 'antd/es/time-picker';
import Slider from 'antd/es/slider';
import Rate from 'antd/es/rate';
import Cascader from 'antd/es/cascader';
import TreeSelect from 'antd/es/tree-select';
import AutoComplete from 'antd/es/auto-complete';
import Segmented from 'antd/es/segmented';
import dayjs from 'dayjs';
import customParseFormat from 'dayjs/plugin/customParseFormat';
import 'dayjs/locale/zh-cn';
import 'dayjs/locale/en';
import type { FieldDef } from './components';
import { AntdSurface } from './AntdSurface';
import { materialOptions } from './antdOptions';
import { isEnLocale, tr, useI18n } from '../../i18n';

dayjs.extend(customParseFormat);

export const ANTD_FIELD_KINDS = new Set(['input', 'number', 'textarea', 'select', 'radio', 'checkbox', 'switch', 'date', 'dateRange', 'time', 'slider', 'rate', 'cascader', 'treeSelect', 'autoComplete', 'segmented']);

interface Props {
  def: FieldDef;
  value: unknown;
  onChange: (value: unknown) => void;
  disabled: boolean;
  size: 'small' | 'middle' | 'large';
  placeholder: string;
  error?: string;
  onClick?: () => void;
}

/** Dates remain strings in the DSL/runtime, never Dayjs objects in saved data. */
export function parseMaterialDate(value: unknown, format: string) {
  if (value === '' || value === null || value === undefined) return null;
  if (typeof value !== 'string') throw new Error(tr(`日期值必须是 ${format} 字符串`, `Date value must be a ${format} string`));
  const parsed = dayjs(value, format, true);
  if (!parsed.isValid()) throw new Error(tr(`日期值不符合 ${format} 格式：${value}`, `Date value does not match ${format}: ${value}`));
  return parsed.locale(isEnLocale() ? 'en' : 'zh-cn');
}

function renderControl({ def, value, onChange, disabled, size, placeholder, error, onClick }: Props) {
  const locked = disabled || Boolean(def.readOnly);
  const common = { size, onClick, placeholder, disabled, status: error ? 'error' as const : def.status, variant: def.variant, style: def.layoutFrame ? positionedStyle(def.layoutFrame) : { width: '100%' } };
  const textProps = { ...common, value: typeof value === 'string' ? value : '', readOnly: def.readOnly, allowClear: def.allowClear && !def.readOnly, maxLength: def.maxLength, showCount: def.showCount, onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => onChange(e.target.value) };
  switch (def.type) {
    case 'input':
      return def.password
        ? <Input.Password {...textProps} prefix={def.prefix} suffix={def.suffix} visibilityToggle={def.visibilityToggle !== false} />
        : <Input {...textProps} prefix={def.prefix} suffix={def.suffix} />;
    case 'textarea':
      return <Input.TextArea {...textProps} rows={def.rows ?? 3} autoSize={def.autoSize ? { minRows: def.minRows ?? 2, maxRows: def.maxRows ?? 6 } : false} />;
    case 'number':
      return <InputNumber {...common} readOnly={def.readOnly} value={value === '' ? null : value as number | null} onChange={onChange} min={def.min} max={def.max} step={def.step} precision={def.precision} prefix={def.prefix} suffix={def.suffix} controls={def.controls !== false} keyboard={def.keyboard !== false} />;
    case 'select': {
      const options = materialOptions(def.options);
      const hasEmptyOption = options.some((o) => o.value === '');
      // `multiple` is the existing DSL contract; mode takes precedence when explicitly configured.
      const mode = def.mode === 'single' ? undefined : def.mode ?? (def.multiple ? 'multiple' : undefined);
      return <Select {...common} disabled={locked} options={options} mode={mode} value={mode ? (Array.isArray(value) ? value : []) : value === '' && !hasEmptyOption ? undefined : value}
        onChange={(v) => onChange(v === undefined ? '' : v)} allowClear={def.allowClear} showSearch={def.showSearch ? { optionFilterProp: 'label' } : false}
        loading={def.loading} maxTagCount={def.maxTagCount} maxCount={def.maxCount} popupMatchSelectWidth={def.popupMatchSelectWidth} />;
    }
    case 'radio':
      return <Radio.Group size={size} value={value} options={materialOptions(def.options)} disabled={locked} optionType={def.optionType} buttonStyle={def.buttonStyle} onChange={(e) => onChange(e.target.value)} style={def.direction === 'vertical' ? { display: 'flex', flexDirection: 'column', gap: 8 } : undefined} />;
    case 'checkbox':
      return <Checkbox.Group value={Array.isArray(value) ? value : []} options={materialOptions(def.options)} disabled={locked} onChange={onChange} style={def.direction === 'vertical' ? { display: 'flex', flexDirection: 'column', gap: 8 } : undefined} />;
    case 'switch':
      return <Switch checked={value === true} disabled={locked} size={size === 'small' ? 'small' : 'default'} loading={def.loading} checkedChildren={def.checkedChildren} unCheckedChildren={def.unCheckedChildren} onChange={onChange} />;
    case 'date': {
      const withTime = def.picker === 'datetime' || def.showTime;
      const format = withTime ? 'YYYY-MM-DDTHH:mm' : def.picker === 'month' ? 'YYYY-MM' : def.picker === 'year' ? 'YYYY' : 'YYYY-MM-DD';
      return <DatePicker {...common} disabled={locked} picker={def.picker === 'datetime' ? 'date' : def.picker} showTime={withTime} format={withTime ? 'YYYY-MM-DD HH:mm' : format}
        value={parseMaterialDate(value, format)} onChange={(v) => onChange(v ? v.format(format) : '')} allowClear={def.allowClear !== false} />;
    }
    case 'dateRange': {
      const format = def.showTime ? 'YYYY-MM-DDTHH:mm' : 'YYYY-MM-DD';
      const dates = Array.isArray(value) ? value : ['', ''];
      return <DatePicker.RangePicker {...common} placeholder={[tr('开始日期', 'Start date'), tr('结束日期', 'End date')]} disabled={locked} showTime={def.showTime} format={def.showTime ? 'YYYY-MM-DD HH:mm' : format} allowClear={def.allowClear !== false}
        value={[parseMaterialDate(dates[0], format), parseMaterialDate(dates[1], format)]} onChange={(v) => onChange(v ? v.map((d) => d ? d.format(format) : '') : [])} />;
    }
    case 'time': {
      const format = def.format ?? 'HH:mm:ss';
      for (const [key, limit] of [['hourStep', 23], ['minuteStep', 59], ['secondStep', 59]] as const) {
        if (def[key] !== undefined && (!Number.isInteger(def[key]) || def[key]! < 1 || def[key]! > limit)) throw new Error(tr(`${key} 必须是 1 到 ${limit} 的整数`, `${key} must be an integer between 1 and ${limit}`));
      }
      return <TimePicker {...common} disabled={locked} format={format} value={parseMaterialDate(value, format)} onChange={(v) => onChange(v ? v.format(format) : '')} allowClear={def.allowClear !== false} use12Hours={def.use12Hours} hourStep={def.hourStep as TimePickerProps['hourStep']} minuteStep={def.minuteStep as TimePickerProps['minuteStep']} secondStep={def.secondStep as TimePickerProps['secondStep']} />;
    }
    case 'slider': {
      const props = { disabled: locked, min: def.min, max: def.max, step: def.step, reverse: def.reverse, dots: def.dots, tooltip: { open: def.tooltipVisible ? true : undefined } };
      return def.range
        ? <Slider {...props} range value={Array.isArray(value) ? value : [def.min ?? 0, def.max ?? 100]} onChange={onChange} />
        : <Slider {...props} value={typeof value === 'number' ? value : def.min ?? 0} onChange={onChange} />;
    }
    case 'rate':
      return <Rate value={typeof value === 'number' ? value : 0} disabled={locked} count={def.count} allowHalf={def.allowHalf} allowClear={def.allowClear !== false} onChange={onChange} />;
    case 'cascader':
      return <Cascader {...common} disabled={locked} options={materialOptions(def.options, true)} value={Array.isArray(value) ? value : []} onChange={onChange} changeOnSelect={def.changeOnSelect} expandTrigger={def.expandTrigger} showSearch={def.showSearch} allowClear={def.allowClear} />;
    case 'treeSelect': {
      const multi = def.multiple || def.treeCheckable;
      return <TreeSelect {...common} disabled={locked} treeData={materialOptions(def.options, true)} fieldNames={{ label: 'label', value: 'value', children: 'children' }} treeNodeFilterProp="label"
        value={multi ? (Array.isArray(value) ? value : []) : value === '' ? undefined : value} onChange={(v) => onChange(v === undefined ? '' : v)} multiple={def.multiple} treeCheckable={def.treeCheckable} treeDefaultExpandAll={def.treeDefaultExpandAll} showSearch={def.showSearch} allowClear={def.allowClear} maxTagCount={def.maxTagCount} />;
    }
    case 'autoComplete': {
      const options = materialOptions(def.options);
      if (options.some((o) => typeof o.value !== 'string')) throw new Error(tr('自动补全的 value 必须为字符串', 'AutoComplete option values must be strings'));
      return <AutoComplete {...common} disabled={locked} value={typeof value === 'string' ? value : ''} options={options} onChange={onChange} allowClear={def.allowClear}
        filterOption={(input, option) => String(option?.label).toLowerCase().includes(input.toLowerCase())} />;
    }
    case 'segmented':
      return <Segmented size={size} disabled={locked} options={materialOptions(def.options)} value={value === '' ? undefined : value as string | number} onChange={onChange} block={def.block} vertical={def.direction === 'vertical'} />;
  }
  return null;
}

export const AntdFieldControl: React.FC<Props> = (props) => {
  const { tr: t, td } = useI18n();
  try {
    return <AntdSurface>{renderControl(props)}</AntdSurface>;
  } catch (error) {
    return <div role="alert" className="rounded border border-red-200 bg-red-50 p-2 text-xs text-red-600">{error instanceof Error ? td(error.message) : t('控件配置无效', 'Invalid control config')}</div>;
  }
};
