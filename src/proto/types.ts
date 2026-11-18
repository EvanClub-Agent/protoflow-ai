/**
 * Alex page DSL — "code as the source, controls on top".
 *
 * A page is a constrained TSX file (pages/<id>.page.tsx) that may only use components
 * from the Alex registry. The designer parses it into this tree, edits the tree,
 * and prints canonical TSX back. AI models generate / patch the same TSX.
 */

/** A chain of whitelisted action calls, written in TSX as `() => { openModal('m-add'); toast('ok'); }` */
export interface ActionCall {
  name: string;
  args: PropValue[];
}

export interface ActionChain {
  $kind: 'actions';
  calls: ActionCall[];
}

/** Any expression the DSL does not understand is preserved verbatim (escape hatch for hand-written code). */
export interface RawExpr {
  $kind: 'raw';
  code: string;
}

export type PropValue =
  | string
  | number
  | boolean
  | null
  | PropValue[]
  | ActionChain
  | RawExpr
  | { [key: string]: PropValue };

export interface TextChild {
  kind: 'text';
  value: string;
}

export interface ProtoNode {
  kind: 'node';
  /** Stable id used by stickies, bindings, AI patches and the closed-loop audit */
  pfId: string;
  type: string;
  props: Record<string, PropValue>;
  children: ProtoChild[];
}

export type ProtoChild = ProtoNode | TextChild;

export interface ProtoDoc {
  /** Leading comment lines (e.g. `// @protoflow page: supplier-manage`) */
  header: string[];
  root: ProtoNode;
}

export interface ParseIssue {
  level: 'error' | 'warning' | 'info';
  message: string;
  pfId?: string;
}

export interface ParseResult {
  doc: ProtoDoc | null;
  issues: ParseIssue[];
  /** True when missing pfIds were assigned during parsing (caller should persist the printed source) */
  normalized: boolean;
}

export const isActionChain = (v: unknown): v is ActionChain =>
  !!v && typeof v === 'object' && !Array.isArray(v) && (v as ActionChain).$kind === 'actions';

export const isRawExpr = (v: unknown): v is RawExpr =>
  !!v && typeof v === 'object' && !Array.isArray(v) && (v as RawExpr).$kind === 'raw';

export const isNode = (c: ProtoChild | undefined | null): c is ProtoNode => !!c && c.kind === 'node';
