import React from 'react';
import Avatar from 'antd/es/avatar';
import Badge from 'antd/es/badge';
import Collapse from 'antd/es/collapse';
import Flex from 'antd/es/flex';
import Image from 'antd/es/image';
import Popconfirm from 'antd/es/popconfirm';
import Popover from 'antd/es/popover';
import Progress from 'antd/es/progress';
import Skeleton from 'antd/es/skeleton';
import Spin from 'antd/es/spin';
import Tooltip from 'antd/es/tooltip';
import type { CompProps } from './components';
import { AntdSurface } from './AntdSurface';
import { tr, useI18n } from '../../i18n';

const Placeholder = () => {
  const { tr: t } = useI18n();
  return <div className="min-h-12 w-full rounded border border-dashed border-slate-300 p-3 text-center text-xs text-slate-400">{t('拖入组件', 'Drop components here')}</div>;
};
const content = (props: CompProps) => props.children.length ? props.children : props.rt.isDesign ? <Placeholder /> : null;

function material(render: (props: CompProps) => React.ReactNode): React.FC<CompProps> {
  return function AntdMaterial(props) {
    useI18n();
    return <div {...props.root}><AntdSurface>{render(props)}</AntdSurface></div>;
  };
}

export const ANTD_COMPONENTS: Record<string, React.FC<CompProps>> = {
  Flex: material((props) => <Flex vertical={props.p.vertical} wrap={props.p.wrap ? 'wrap' : 'nowrap'} gap={props.p.gap ?? 12} justify={props.p.justify} align={props.p.align}>{content(props)}</Flex>),
  Collapse: material(({ p, kids, rt, scope, renderNode }) => <Collapse
    accordion={!rt.isDesign && p.accordion} bordered={p.bordered !== false} ghost={p.ghost} size={p.size} expandIconPlacement={p.expandIconPosition === 'end' ? 'end' : 'start'}
    // All panels stay open while designing, so hidden children remain editable.
    {...(rt.isDesign ? { activeKey: kids.map((k) => k.pfId) } : {})}
    defaultActiveKey={p.defaultExpandAll ? kids.map((k) => k.pfId) : kids.slice(0, 1).map((k) => k.pfId)}
    onChange={(keys) => { if (!rt.isDesign) rt.run(p.onChange, { ...scope, params: { ...scope.params, value: keys } }); }}
    items={kids.map((k) => ({ key: k.pfId, label: String(k.props.title ?? tr('折叠面板', 'Collapse Panel')), extra: typeof k.props.extra === 'string' ? k.props.extra : undefined, collapsible: k.props.disabled === true && !rt.isDesign ? 'disabled' : undefined, children: renderNode(k) }))}
  />),
  CollapsePanel: material((props) => <div className="grid grid-cols-12 gap-3">{props.children.length ? props.children : props.rt.isDesign ? <div className="col-span-12"><Placeholder /></div> : null}</div>),
  Avatar: material(({ p, text }) => <Avatar src={p.src} alt={p.alt} shape={p.shape} size={p.size ?? 40} style={{ backgroundColor: p.backgroundColor, color: p.color }}>{text || 'U'}</Avatar>),
  Badge: material((props) => <Badge count={props.p.count} overflowCount={props.p.overflowCount} showZero={props.p.showZero} dot={props.p.dot} status={props.p.status} text={props.p.text} color={props.p.color}>{props.children.length ? <div>{props.children}</div> : null}</Badge>),
  Progress: material(({ p }) => <Progress percent={p.percent ?? 50} type={p.type} status={p.status} showInfo={p.showInfo !== false} size={p.size} steps={p.steps} strokeColor={p.strokeColor} strokeLinecap={p.strokeLinecap} />),
  Image: material(({ p, rt }) => p.src
    ? <Image src={p.src} alt={p.alt} width={p.imageWidth ?? 240} height={p.imageHeight} preview={!rt.isDesign && p.preview !== false} style={{ objectFit: p.objectFit }} />
    : <div className="flex min-h-28 items-center justify-center rounded border border-dashed border-slate-300 bg-slate-50 text-xs text-slate-400 px-2 text-center">{tr('请在属性面板设置图片地址', 'Set image URL in the inspector')}</div>),
  Skeleton: material((props) => <Skeleton active={props.p.active !== false} avatar={props.p.avatar} title={props.p.title !== false} paragraph={{ rows: props.p.rows ?? 3 }} round={props.p.round} loading={props.p.loading !== false}>{content(props)}</Skeleton>),
  Spin: material((props) => <Spin spinning={props.p.spinning !== false} size={props.p.size} description={props.p.tip}>{props.children.length ? <div>{props.children}</div> : props.rt.isDesign ? <div className="min-h-20"><Placeholder /></div> : undefined}</Spin>),
  Tooltip: material((props) => <Tooltip title={props.p.title} placement={props.p.placement} trigger={props.p.trigger} color={props.p.color} {...(props.rt.isDesign ? { open: false } : {})}><span className="inline-flex" tabIndex={0}>{content(props)}</span></Tooltip>),
  Popover: material((props) => <Popover title={props.p.title} content={props.p.content} placement={props.p.placement} trigger={props.p.trigger ?? 'click'} {...(props.rt.isDesign ? { open: false } : {})}><span className="inline-flex" tabIndex={0}>{content(props)}</span></Popover>),
  Popconfirm: material((props) => <Popconfirm title={props.p.title} description={props.p.description} placement={props.p.placement} okText={props.p.okText ?? tr('确定', 'OK')} cancelText={props.p.cancelText ?? tr('取消', 'Cancel')} disabled={props.p.disabled}
    {...(props.rt.isDesign ? { open: false } : {})}
    onConfirm={() => { if (!props.rt.isDesign) props.rt.run(props.p.onConfirm, props.scope); }}
    onCancel={() => { if (!props.rt.isDesign) props.rt.run(props.p.onCancel, props.scope); }}><span className="inline-flex">{content(props)}</span></Popconfirm>),
};
