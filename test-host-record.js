#!/usr/bin/env node
/**
 * Test script for dnsmasq record formats
 *
 * A records must be written as `host-record=name,ip` rather than
 * `address=/name/ip`, because dnsmasq only resolves a `cname=` whose target is
 * a name it already knows from host-record, /etc/hosts or a DHCP lease.
 * Records written by earlier versions in the `address=` form must still be
 * readable so external-dns can reconcile them.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

// Set required environment variables for testing
process.env.DOMAIN_FILTER = 'test.local';
process.env.SHARED_SECRET = 'test-secret';
process.env.DNSMASQ_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'test-dnsmasq-'));
process.env.LOG_LEVEL = 'error';

const dnsmasqDir = process.env.DNSMASQ_DIR;
const dnsmasq = require('./src/services/dnsmasq');

let failures = 0;

function check(label, actual, expected) {
  const ok = actual === expected;
  if (!ok) {
    failures++;
  }
  console.log(`${ok ? 'PASS' : 'FAIL'}: ${label}`);
  if (!ok) {
    console.log(`      expected: ${expected}`);
    console.log(`      actual:   ${actual}`);
  }
}

function removeDir(dir) {
  // fs.rmSync needs Node >= 14.14; Firewalla ships Node 12.14
  if (fs.rmSync) {
    fs.rmSync(dir, { recursive: true, force: true });
  } else {
    fs.rmdirSync(dir, { recursive: true });
  }
}

function readRecordFile(name) {
  return fs.readFileSync(path.join(dnsmasqDir, name), 'utf8').trim();
}

async function main() {
  console.log('Testing dnsmasq record formats...');

  // writeRecord rather than applyChanges: applyChanges ends by restarting
  // firerouter_dns, which this test has no business doing on a Firewalla.
  await dnsmasq.writeRecord({ dnsName: 'a.test.local', targets: ['192.168.1.100'], recordType: 'A' });
  await dnsmasq.writeRecord({ dnsName: 'multi.test.local', targets: ['192.168.1.101', '192.168.1.102'], recordType: 'A' });
  await dnsmasq.writeRecord({ dnsName: 'cname.test.local', targets: ['a.test.local'], recordType: 'CNAME' });
  await dnsmasq.writeRecord({ dnsName: 'txt.test.local', targets: ['heritage=external-dns'], recordType: 'TXT' });

  // Written formats
  check('A record uses host-record', readRecordFile('a.test.local'),
    'host-record=a.test.local,192.168.1.100');

  check('multiple A targets each get a host-record line', readRecordFile('multi.test.local'),
    'host-record=multi.test.local,192.168.1.101\nhost-record=multi.test.local,192.168.1.102');

  check('CNAME record unchanged', readRecordFile('cname.test.local'),
    'cname=cname.test.local,a.test.local');

  check('TXT record unchanged', readRecordFile('txt.test.local.txt'),
    'txt-record=txt.test.local,"heritage=external-dns"');

  // A record written by an earlier version, which must still be readable
  fs.writeFileSync(path.join(dnsmasqDir, 'legacy.test.local'),
    'address=/legacy.test.local/192.168.1.200\n');

  const records = await dnsmasq.getRecords();
  const byName = {};
  for (const record of records) {
    byName[record.dnsName] = record;
  }

  check('host-record reads back as A', `${byName['a.test.local'].recordType} ${byName['a.test.local'].targets.join(',')}`,
    'A 192.168.1.100');

  check('multiple host-record lines read back as one record', byName['multi.test.local'].targets.join(','),
    '192.168.1.101,192.168.1.102');

  check('cname reads back as CNAME', `${byName['cname.test.local'].recordType} ${byName['cname.test.local'].targets.join(',')}`,
    'CNAME a.test.local');

  check('legacy address= still reads back as A', `${byName['legacy.test.local'].recordType} ${byName['legacy.test.local'].targets.join(',')}`,
    'A 192.168.1.200');

  removeDir(dnsmasqDir);

  console.log(`Record format tests completed with ${failures} failure(s).`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch(err => {
  console.error('Test run failed:', err);
  removeDir(dnsmasqDir);
  process.exit(1);
});
