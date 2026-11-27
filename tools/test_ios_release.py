#!/usr/bin/env python3
"""Pruebas de la versión de iOS y de la fuente de SideStore / AltStore: python tools/test_ios_release.py"""
import argparse
import json
import os
import tempfile
import unittest

import make_source
from ios_version import ios_version


def numbers(version):
    return [int(x) for x in version.split('.')]


def args(tag, build, out, date='2026-11-28'):
    return argparse.Namespace(tag=tag, version=ios_version(tag), build=str(build), ipa=f'Nsound-{tag[1:]}-unsigned.ipa',
                              sha256='a' * 64, size='123', date=date, notes=f'Nsound {tag}', out=out)


class IosVersion(unittest.TestCase):
    def test_examples(self):
        for tag, expected in [('v0.8.0-beta.11', '0.8.11'), ('v0.8.0', '0.8.999'), ('v0.8.1-beta.1', '0.8.1001'),
                              ('v0.9.0-beta.1', '0.9.1'), ('v1.0.0-rc.2', '1.0.902')]:
            self.assertEqual(ios_version(tag), expected, tag)

    def test_grows_with_every_release(self):
        tags = ['v0.8.0-beta.11', 'v0.8.0-beta.12', 'v0.8.0-beta.100', 'v0.8.0-rc.1', 'v0.8.0',
                'v0.8.1-beta.1', 'v0.8.1', 'v0.9.0-beta.1', 'v1.0.0']
        versions = [numbers(ios_version(t)) for t in tags]
        self.assertEqual(versions, sorted(versions))
        self.assertEqual(len(set(map(tuple, versions))), len(tags))
        self.assertGreater(versions[0], numbers('0.8.0'))   # lo que llevan las betas 9 y 10 instaladas

    def test_rejects_other_tags(self):
        for tag in ['v0.8', 'v0.8.0-alpha.1', 'v0.8.0-beta', 'v0.8.0-beta.0', 'v0.8.0-beta.900', 'v0.8.0-rc.99', 'dev-abc', '']:
            with self.assertRaises(ValueError, msg=tag):
                ios_version(tag)


class Source(unittest.TestCase):
    def setUp(self):
        self.dir = tempfile.TemporaryDirectory()
        self.out = os.path.join(self.dir.name, 'source.json')

    def tearDown(self):
        self.dir.cleanup()

    def publish(self, a):
        data = make_source.build(a, make_source.previous_versions(a.out))
        with open(a.out, 'w', encoding='utf-8') as f:
            json.dump(data, f)
        return data['apps'][0]

    def test_keeps_previous_versions_newest_first(self):
        old = {'version': '0.8.0', 'buildVersion': '71', 'date': '2026-11-17', 'downloadURL': 'https://example.test/b10.ipa', 'size': 1}
        with open(self.out, 'w', encoding='utf-8') as f:
            json.dump({'apps': [{'versions': [old]}]}, f)
        app = self.publish(args('v0.8.0-beta.11', 90, self.out))
        app = self.publish(args('v0.8.0-beta.12', 91, self.out))
        self.assertEqual([v['version'] for v in app['versions']], ['0.8.12', '0.8.11', '0.8.0'])
        self.assertEqual(app['versions'][-1], old)
        self.assertEqual((app['version'], app['versionDate']), ('0.8.12', '2026-11-28'))
        self.assertEqual(app['downloadURL'], app['versions'][0]['downloadURL'])
        self.assertEqual(app['versions'][0]['buildVersion'], '91')
        self.assertEqual((app['versions'][0]['size'], app['versions'][0]['sha256']), (123, 'a' * 64))

    def test_republishing_replaces_its_entry(self):
        self.publish(args('v0.8.0-beta.11', 90, self.out))
        app = self.publish(args('v0.8.0-beta.11', 95, self.out))
        self.assertEqual([v['buildVersion'] for v in app['versions']], ['95'])

    def test_rerunning_an_old_release_does_not_downgrade(self):
        self.publish(args('v0.8.0-beta.12', 91, self.out))
        app = self.publish(args('v0.8.0-beta.11', 92, self.out))
        self.assertEqual(app['version'], '0.8.12')
        self.assertTrue(app['downloadURL'].endswith('v0.8.0-beta.12/Nsound-0.8.0-beta.12-unsigned.ipa'))

    def test_broken_file_fails_instead_of_losing_history(self):
        with open(self.out, 'w', encoding='utf-8') as f:
            f.write('{')
        with self.assertRaises(ValueError):
            make_source.previous_versions(self.out)

    def test_published_source_is_readable(self):
        path = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'site', 'source.json')
        self.assertTrue(make_source.previous_versions(path))


if __name__ == '__main__':
    unittest.main()
