export interface StackSortable {
  stackId?: string | null;
  stackName?: string | null;
  peptideName?: string | null;
  name?: string | null;
}

function label(v: string | null | undefined): string {
  return (v ?? "").trim().toLocaleLowerCase();
}

export function stackGroupLabel(item: StackSortable): string {
  return item.stackName || item.peptideName || item.name || "";
}

export function compareStackGrouped(a: StackSortable, b: StackSortable): number {
  const aGroup = label(stackGroupLabel(a));
  const bGroup = label(stackGroupLabel(b));
  const groupCmp = aGroup.localeCompare(bGroup);
  if (groupCmp !== 0) return groupCmp;

  const aStack = label(a.stackId);
  const bStack = label(b.stackId);
  const stackCmp = aStack.localeCompare(bStack);
  if (stackCmp !== 0) return stackCmp;

  const aItem = label(a.peptideName || a.name);
  const bItem = label(b.peptideName || b.name);
  return aItem.localeCompare(bItem);
}

export function compareTime(a: string | null | undefined, b: string | null | undefined): number {
  return (a ?? "").localeCompare(b ?? "");
}
