/** javascript-obfuscator 风格的 `_0x` 十六进制标识符生成器,全局去重 */
export class NameGen {
  private used = new Set<string>();
  private counter: number;

  constructor(start = 0x100) {
    this.counter = start;
  }

  reserve(names: Iterable<string>): void {
    for (const n of names) this.used.add(n);
  }

  next(): string {
    let name: string;
    do {
      name = '_0x' + (this.counter++).toString(16);
    } while (this.used.has(name));
    this.used.add(name);
    return name;
  }
}
