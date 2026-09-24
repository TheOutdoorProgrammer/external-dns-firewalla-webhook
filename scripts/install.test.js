const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const installer = path.join(__dirname, 'install.sh');
const secret = 'fixture-only-'.repeat(5);
const sudoers = 'pi ALL=(ALL) NOPASSWD: /bin/systemctl restart firerouter_dns\n';
let passed = 0;

function test(name, prepare, verify) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'firewalla-install-test-'));
  try {
    fs.mkdirSync(path.join(root, 'source/src'), { recursive: true });
    fs.mkdirSync(path.join(root, 'source/systemd'));
    fs.mkdirSync(path.join(root, 'source/node_modules'));
    fs.mkdirSync(path.join(root, 'units'));
    fs.mkdirSync(path.join(root, 'dns'));
    fs.writeFileSync(path.join(root, 'dns/existing.conf'), 'preserve this DNS record\n');
    fs.writeFileSync(path.join(root, 'source/src/server.js'), '');
    fs.writeFileSync(path.join(root, 'source/systemd/external-dns-firewalla-webhook.service'), '[Unit]\n');
    fs.writeFileSync(path.join(root, 'source/.env.example'), 'DOMAIN_FILTER=example.com\nSHARED_SECRET=placeholder\nPORT_PROVIDER=8888\n');
    fs.writeFileSync(path.join(root, 'domain'), 'example.test\n', { mode: 0o600 });
    fs.writeFileSync(path.join(root, 'secret'), secret + '\n', { mode: 0o600 });
    fs.writeFileSync(path.join(root, 'node'), '#!/bin/sh\nprintf "v20.0.0\\n"\n', { mode: 0o700 });
    prepare(root);
    const result = spawnSync('bash', ['-c', `
if [[ -f "$TEST_ROOT/trace-enabled" ]]; then set -x; fi
source "$1"
INSTALL_DIR="$TEST_ROOT/installed"
UNIT_FILE="$TEST_ROOT/units/provider.service"
DNSMASQ_DIR="$TEST_ROOT/dns"
SUDOERS_FILE="$TEST_ROOT/sudoers"
NODE_PATH="$TEST_ROOT/node"
whoami() { printf 'pi\\n'; }
systemctl() {
    printf 'systemctl %s\\n' "$*" >> "$TEST_ROOT/commands"
    if [[ "$1" == show ]]; then
        if [[ "$2" == --property=NoNewPrivileges ]]; then
            if [[ -f "$TEST_ROOT/no-new-privileges" ]]; then printf 'yes\\n'; else printf 'no\\n'; fi
        elif [[ -f "$TEST_ROOT/registered" ]]; then printf 'loaded\\n'; else printf 'not-found\\n'; fi
    fi
}
sudo() {
    printf 'sudo %s\\n' "$*" >> "$TEST_ROOT/commands"
    case "$1" in
        visudo) [[ ! -f "$TEST_ROOT/invalid-sudoers" ]] ;;
        chown) return 0 ;;
        systemctl) shift; systemctl "$@" ;;
        install) shift 5; command install "$@" ;;
        *) command "$@" ;;
    esac
}
if [[ "$TEST_STAT_STYLE" == bsd ]]; then
    stat() { command stat -f '%Lp' "$3"; }
fi
install_provider --source-dir "$TEST_ROOT/source" --config-file "$TEST_ROOT/domain" --secret-file "$TEST_ROOT/secret"
`, '--', installer], { encoding: 'utf8', env: { ...process.env, TEST_ROOT: root, TEST_STAT_STYLE: process.platform === 'darwin' ? 'bsd' : 'gnu' } });
    if (result.error) throw result.error;
    const commands = fs.existsSync(path.join(root, 'commands')) ? fs.readFileSync(path.join(root, 'commands'), 'utf8') : '';
    for (const output of [result.stdout, result.stderr, commands]) {
      assert(!output.includes(secret), 'secret reached output or arguments');
      assert(!output.includes(secret.slice(0, 8)), 'secret prefix reached output or arguments');
    }
    assert.strictEqual(fs.readFileSync(path.join(root, 'dns/existing.conf'), 'utf8'), 'preserve this DNS record\n');
    verify(root, result, commands);
    passed++;
    console.log('PASS ' + name);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

function rejected(root, result, commands) {
  assert.notStrictEqual(result.status, 0, result.stdout);
  assert(!commands.includes('sudo mkdir'), 'failure changed installation');
  assert(!commands.includes('systemctl start'), 'failure started service');
}

test('fresh install preserves DNS and writes private matching credentials', () => {}, (root, result, commands) => {
  assert.strictEqual(result.status, 0, result.stderr);
  const env = fs.readFileSync(path.join(root, 'installed/.env'), 'utf8');
  assert.strictEqual(env, 'PORT_PROVIDER=8888\nDOMAIN_FILTER=example.test\nSHARED_SECRET=' + secret + '\n');
  assert.strictEqual(fs.statSync(path.join(root, 'installed/.env')).mode & 0o777, 0o600);
  assert.strictEqual(fs.readFileSync(path.join(root, 'secret'), 'utf8'), secret + '\n');
  assert(commands.includes('systemctl start external-dns-firewalla-webhook'));
  assert(!commands.includes('systemctl restart firerouter_dns'));
});

test('existing installation remains intact', root => {
  fs.mkdirSync(path.join(root, 'installed'));
  fs.writeFileSync(path.join(root, 'installed/keep'), 'unchanged');
}, (root, result, commands) => {
  rejected(root, result, commands);
  assert.strictEqual(fs.readFileSync(path.join(root, 'installed/keep'), 'utf8'), 'unchanged');
});
test('dangling install symlink is rejected', root => fs.symlinkSync('missing', path.join(root, 'installed')), rejected);
test('existing systemd unit is rejected', root => fs.writeFileSync(path.join(root, 'units/provider.service'), 'keep'), rejected);
test('registered service is rejected', root => fs.writeFileSync(path.join(root, 'registered'), ''), rejected);
test('failed sudoers validation precedes installation', root => fs.writeFileSync(path.join(root, 'invalid-sudoers'), ''), rejected);
test('configured NoNewPrivileges prevents enable and start', root => fs.writeFileSync(path.join(root, 'no-new-privileges'), ''), (_root, result, commands) => {
  assert.notStrictEqual(result.status, 0, result.stdout);
  assert(commands.includes('systemctl daemon-reload'));
  assert(!commands.includes('systemctl enable'));
  assert(!commands.includes('systemctl start'));
});
test('inherited xtrace cannot expose credentials', root => fs.writeFileSync(path.join(root, 'trace-enabled'), ''), (_root, result) => {
  assert.strictEqual(result.status, 0, result.stderr);
});
test('world-readable secret is rejected', root => fs.chmodSync(path.join(root, 'secret'), 0o644), rejected);
test('secret symlink is rejected', root => {
  fs.renameSync(path.join(root, 'secret'), path.join(root, 'original'));
  fs.symlinkSync('original', path.join(root, 'secret'));
}, rejected);
test('multiline secret is rejected', root => fs.appendFileSync(path.join(root, 'secret'), 'injected=value\n'), rejected);
test('short secret is rejected', root => fs.writeFileSync(path.join(root, 'secret'), 'short'), rejected);
test('source containing .env is rejected', root => fs.writeFileSync(path.join(root, 'source/.env'), 'keep'), rejected);
test('conflicting sudoers remains untouched', root => fs.writeFileSync(path.join(root, 'sudoers'), 'different policy\n'), (root, result, commands) => {
  rejected(root, result, commands);
  assert.strictEqual(fs.readFileSync(path.join(root, 'sudoers'), 'utf8'), 'different policy\n');
});
test('matching sudoers is preserved', root => fs.writeFileSync(path.join(root, 'sudoers'), sudoers), (root, result, commands) => {
  assert.strictEqual(result.status, 0, result.stderr);
  assert.strictEqual(fs.readFileSync(path.join(root, 'sudoers'), 'utf8'), sudoers);
  assert(!commands.split('\n').some(line => line.startsWith('sudo install') && line.endsWith('/sudoers')));
});
const legacySudoers = '# Allow pi user to restart firerouter_dns for external-dns-firewalla-webhook\n' + sudoers;
test('legacy installer comment is preserved', root => fs.writeFileSync(path.join(root, 'sudoers'), legacySudoers), (root, result) => {
  assert.strictEqual(result.status, 0, result.stderr);
  assert.strictEqual(fs.readFileSync(path.join(root, 'sudoers'), 'utf8'), legacySudoers);
});
test('sudoers include directives are not ignored as comments', root => fs.writeFileSync(path.join(root, 'sudoers'), '#include /another-policy\n' + sudoers), rejected);
console.log(passed + ' installer tests passed');
