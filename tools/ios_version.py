#!/usr/bin/env python3
"""Convierte la etiqueta de una versión en la versión de iOS (CFBundleShortVersionString): python tools/ios_version.py v0.8.0-beta.11

iOS solo entiende tres números y SideStore / AltStore necesitan que cada publicación lleve uno mayor que la anterior.
El tercer número es PARCHE × 1000 + fase, donde la fase es N en «beta.N» (1-899), 900 + N en «rc.N» (1-98) y 999 en la final:

  v0.8.0-beta.11 → 0.8.11    v0.8.0 → 0.8.999    v0.8.1-beta.1 → 0.8.1001    v0.9.0-beta.1 → 0.9.1

Así 0.8.11 supera al «0.8.0» de las betas 9 y 10, y la versión final supera a todas sus betas.
"""
import re
import sys

TAG = re.compile(r'v?(\d+)\.(\d+)\.(\d+)(?:-(beta|rc)\.(\d+))?')


def ios_version(tag):
    m = TAG.fullmatch(tag)
    if not m:
        raise ValueError(f'Etiqueta no admitida: {tag!r}. Usa vX.Y.Z, vX.Y.Z-beta.N o vX.Y.Z-rc.N.')
    major, minor, patch, kind, number = m.groups()
    stage = 999
    if kind:
        n = int(number)
        top, base = (899, 0) if kind == 'beta' else (98, 900)
        if not 1 <= n <= top:
            raise ValueError(f'{kind}.{n} fuera de rango (1-{top}).')
        stage = base + n
    return f'{int(major)}.{int(minor)}.{int(patch) * 1000 + stage}'


if __name__ == '__main__':
    if len(sys.argv) != 2:
        sys.exit('Uso: python tools/ios_version.py <etiqueta>')
    try:
        print(ios_version(sys.argv[1]))
    except ValueError as e:
        sys.exit(str(e))
