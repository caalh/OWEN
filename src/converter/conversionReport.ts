import { mcnpToOpenmc } from './mcnpToOpenmc';

const HEADER = 'Unconvertible constructs are marked';

export function conversionTodos(text: string): string[] {
    return mcnpToOpenmc(text).output
        .split('\n')
        .filter((line) => line.includes('TODO(owen-convert)') && !line.includes(HEADER));
}
