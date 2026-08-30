import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';

import { REPO_ROOT } from '../paths';
import { isUnreachable } from '../../community/browser';

// Guards on the Community Library wiring. The manifest ships live Supabase
// credentials, so most of these checks exist to make a wrong or dangerous
// credential fail here rather than in a published VSIX.

interface Manifest {
    version: string;
    activationEvents: string[];
    contributes: {
        commands: Array<{ command: string; title: string; category?: string }>;
        menus: Record<string, Array<{ command?: string; group?: string; submenu?: string }>>;
        configuration: { properties: Record<string, { default?: unknown }> };
    };
}

function loadManifest(): Manifest {
    return JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'package.json'), 'utf8')) as Manifest;
}

suite('OWEN community library wiring', () => {
    test('searchReactorLibrary is titled Input from Community Library', () => {
        const cmd = loadManifest().contributes.commands.find(
            (c) => c.command === 'owen.searchReactorLibrary',
        );
        assert.ok(cmd, 'owen.searchReactorLibrary is not contributed');
        assert.strictEqual(cmd.title, 'OWEN: Input from Community Library');
        assert.ok(!/Search Reactor Library/.test(cmd.title));
    });

    test('openCommunityLibrary command is declared with an OWEN category', () => {
        const cmd = loadManifest().contributes.commands.find(
            (c) => c.command === 'owen.openCommunityLibrary',
        );
        assert.ok(cmd, 'owen.openCommunityLibrary is not contributed');
        assert.ok(cmd.title.length > 0, 'command has no title');
        assert.strictEqual(cmd.category, 'OWEN');
    });

    test('openCommunityLibrary has an activation event', () => {
        assert.ok(
            loadManifest().activationEvents.includes('onCommand:owen.openCommunityLibrary'),
            'missing onCommand activation event',
        );
    });

    test('openCommunityLibrary appears in both OWEN submenus', () => {
        const menus = loadManifest().contributes.menus;
        for (const name of ['owen.editorTitleMenu', 'owen.contextMenu']) {
            const entries = menus[name] ?? [];
            assert.ok(
                entries.some((e) => e.command === 'owen.openCommunityLibrary'),
                `owen.openCommunityLibrary missing from ${name}`,
            );
        }
    });

    test('community browser ships enabled', () => {
        const props = loadManifest().contributes.configuration.properties;
        assert.strictEqual(props['owen.community.enabled'].default, true);
    });

    test('web URL default points at the ReactorMC community page over https', () => {
        const url = loadManifest().contributes.configuration.properties['owen.community.webUrl']
            .default as string;
        assert.ok(url.startsWith('https://'), `webUrl must be https, got ${url}`);
        assert.ok(url.includes('reactormc.net'), `webUrl must point at reactormc.net, got ${url}`);
    });

    test('supabase url default is an https supabase.co project', () => {
        const url = loadManifest().contributes.configuration.properties['owen.supabase.url']
            .default as string;
        assert.ok(
            /^https:\/\/[a-z0-9-]+\.supabase\.co$/.test(url),
            `unexpected Supabase URL shape: ${url}`,
        );
    });

    // The important one. A publishable/anon key is safe to ship because Row Level
    // Security restricts it to reading approved models; a secret or service_role
    // key bypasses RLS entirely and would be a full database compromise in a
    // public VSIX. Fail loudly if anyone swaps one in.
    test('shipped Supabase key is a publishable key, never a secret one', () => {
        const key = loadManifest().contributes.configuration.properties['owen.supabase.anonKey']
            .default as string;
        assert.ok(key.length > 0, 'no Supabase key shipped');
        assert.ok(
            !key.startsWith('sb_secret_'),
            'a SECRET Supabase key is present in package.json — never ship this',
        );
        assert.ok(
            !key.includes('service_role'),
            'a service_role key is present in package.json — never ship this',
        );
        assert.ok(
            /^sb_publishable_[A-Za-z0-9_-]+$/.test(key) || key.startsWith('eyJ'),
            `unexpected Supabase key shape: ${key.slice(0, 12)}…`,
        );
    });

    test('unreachable-backend detection accepts network and gateway failures', () => {
        for (const message of [
            'TypeError: Failed to fetch',
            'fetch failed',
            'NetworkError when attempting to fetch resource.',
            'Load failed',
            'Project is paused',
            '503 Service Unavailable',
            '502 Bad Gateway',
            'connect ECONNREFUSED 127.0.0.1:443',
            'getaddrinfo ENOTFOUND xyz.supabase.co',
            'signal timed out',
        ]) {
            assert.ok(isUnreachable(message), `should be treated as unreachable: ${message}`);
        }
    });

    test('unreachable-backend detection rejects genuine query errors', () => {
        for (const message of [
            'new row violates row-level security policy for table "models"',
            'permission denied for table models',
            'column models.nope does not exist',
            'JSON object requested, multiple (or no) rows returned',
            'duplicate key value violates unique constraint',
            'operator does not exist: model_code ~~* unknown',
        ]) {
            assert.ok(!isUnreachable(message), `should NOT be treated as unreachable: ${message}`);
        }
    });

    // Regression: models.code is a Postgres enum. .ilike() compiles to ~~*, which
    // does not exist for enums and fails every filtered search (1.1.5).
    test('community search filters code with eq, never ilike', () => {
        const src = fs.readFileSync(
            path.join(REPO_ROOT, 'src', 'community', 'browser.ts'),
            'utf8',
        );
        assert.ok(
            !/\.ilike\(\s*['"]code['"]/.test(src),
            'browser.ts must not .ilike() the code enum column',
        );
        assert.ok(
            /\.eq\(\s*['"]code['"]/.test(src),
            'browser.ts must .eq() the code enum column',
        );
    });
});
