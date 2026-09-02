import { parse } from "@babel/parser";
import traverseModule, { type NodePath } from "@babel/traverse";
import MagicString from "magic-string";
import type { JSXAttribute, JSXElement, JSXOpeningElement } from "@babel/types";

const traverse = ((traverseModule as any).default ?? traverseModule) as (
  ast: ReturnType<typeof parse>,
  visitors: Record<string, (path: any) => void>
) => void;

function getJsxName(node: JSXOpeningElement["name"]): string {
  if (node.type === "JSXIdentifier") return node.name;
  if (node.type === "JSXMemberExpression") {
    const parts: string[] = [];
    let current: any = node;

    while (current?.type === "JSXMemberExpression") {
      parts.unshift(current.property.name);
      current = current.object;
    }

    if (current?.name) parts.unshift(current.name);
    return parts.join(".");
  }

  return "Unknown";
}

function getComponentName(path: NodePath<JSXElement>): string | undefined {
  const fn = path.findParent(
    (p) =>
      p.isFunctionDeclaration() ||
      p.isFunctionExpression() ||
      p.isArrowFunctionExpression() ||
      p.isClassMethod()
  );

  if (!fn) return undefined;
  if (fn.isFunctionDeclaration() && fn.node.id) return fn.node.id.name;

  const parent = fn.parentPath;
  if (parent?.isVariableDeclarator() && parent.node.id.type === "Identifier") {
    return parent.node.id.name;
  }

  if (fn.isClassMethod() && fn.node.key.type === "Identifier") {
    return fn.node.key.name;
  }

  return undefined;
}

function escapeAttr(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll('"', "&quot;");
}

export interface TransformOptions {
  sourceAttribute?: string;
  componentAttribute?: string;
}

/**
 * Inject source metadata into intrinsic DOM JSX nodes only.
 * This avoids relying on React private Fiber fields and keeps React 19+ support viable.
 */
export function injectSourceMetadata(
  code: string,
  id: string,
  options: TransformOptions = {}
): string | null {
  const sourceAttribute = options.sourceAttribute ?? "data-ui-agent-source";
  const componentAttribute =
    options.componentAttribute ?? "data-ui-agent-component";

  const ast = parse(code, {
    sourceType: "module",
    sourceFilename: id,
    plugins: ["jsx", "typescript", "decorators-legacy"]
  });

  const magic = new MagicString(code);
  let changed = false;

  traverse(ast, {
    JSXElement(path: NodePath<JSXElement>) {
      const opening = path.node.openingElement;
      const name = getJsxName(opening.name);

      // Custom components may not forward arbitrary props to the DOM.
      if (!/^[a-z]/.test(name)) return;
      if (!opening.name.loc || opening.name.end == null) return;

      const existing = new Set(
        opening.attributes
          .filter((attr): attr is JSXAttribute => attr.type === "JSXAttribute")
          .map((attr: JSXAttribute) =>
            attr.name.type === "JSXIdentifier" ? attr.name.name : ""
          )
      );

      if (existing.has(sourceAttribute)) return;

      const loc = opening.name.loc.start;
      const relativeFile = id.replace(/^.*?[\\/]src[\\/]/, "src/");
      const component = getComponentName(path);
      const sourceValue = `${relativeFile}:${loc.line}:${loc.column + 1}`;

      let attrs = ` ${sourceAttribute}="${escapeAttr(sourceValue)}"`;
      attrs += ` data-ui-agent-tag="${escapeAttr(name)}"`;

      if (component && !existing.has(componentAttribute)) {
        attrs += ` ${componentAttribute}="${escapeAttr(component)}"`;
      }

      magic.appendLeft(opening.name.end, attrs);
      changed = true;
    }
  });

  return changed ? magic.toString() : null;
}
