import fs from "node:fs";
import path from "node:path";

const WRITE = process.argv.includes("--write");
const SRC_DIR = path.resolve("src");

function listCssModules(dir: string): string[] {
  return fs.readdirSync(dir)
    .filter((name) => name.endsWith(".module.css"))
    .map((name) => path.join(dir, name))
    .sort();
}

function extractClassNames(css: string): string[] {
  const names = new Set<string>();
  for (const match of css.matchAll(/\.(-?[_a-zA-Z]+[_a-zA-Z0-9-]*)/g)) {
    names.add(match[1]);
  }
  return [...names].sort((a, b) => a.localeCompare(b));
}

function styleKey(name: string): string {
  return /^[A-Za-z_$][\w$]*$/.test(name) ? name : JSON.stringify(name);
}

function renderDeclaration(classNames: string[]): string {
  return [
    "declare const styles: {",
    ...classNames.map((name) => `  readonly ${styleKey(name)}: string;`),
    "};",
    "",
    "export default styles;",
    "",
  ].join("\n");
}

function main(): void {
  const changed: string[] = [];
  for (const cssPath of listCssModules(SRC_DIR)) {
    const declarationPath = `${cssPath}.d.ts`;
    const expected = renderDeclaration(extractClassNames(fs.readFileSync(cssPath, "utf8")));
    const actual = fs.existsSync(declarationPath) ? fs.readFileSync(declarationPath, "utf8") : "";
    if (actual === expected) continue;
    if (WRITE) {
      fs.writeFileSync(declarationPath, expected);
    }
    changed.push(path.relative(process.cwd(), declarationPath));
  }

  if (!changed.length) return;
  if (WRITE) {
    console.log(`Updated CSS module declarations:\n${changed.map((file) => `- ${file}`).join("\n")}`);
    return;
  }
  throw new Error(`CSS module declarations are stale. Run "pnpm css:types".\n${changed.map((file) => `- ${file}`).join("\n")}`);
}

main();
