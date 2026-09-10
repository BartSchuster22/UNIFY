import { describe, it, expect, vi } from 'vitest';
import { publicAddress, destination, deliverySignature, verifyDelivery } from './transport.js';
describe('Application callback and source transport', () => {
  for (const address of [
    '0.0.0.0',
    '10.1.2.3',
    '127.0.0.1',
    '169.254.169.254',
    '172.16.0.1',
    '192.168.1.1',
    '100.100.100.200',
    '198.18.0.1',
    '224.0.0.1',
    '255.255.255.255',
    '::1',
    '::ffff:127.0.0.1',
  ])
    it(`rejects non-public destination ${address}`, () =>
      expect(publicAddress(address)).toBe(false));
  it('pins an explicitly validated public DNS answer', async () => {
    const resolve = vi.fn(async () => ['1.1.1.1']);
    expect((await destination('https://example.org/callback', resolve)).address).toBe('1.1.1.1');
    expect(resolve).toHaveBeenCalledTimes(1);
  });
  it('rejects mixed public/private DNS rather than picking the public member', async () => {
    await expect(
      destination('https://example.org/', async () => ['1.1.1.1', '127.0.0.1']),
    ).rejects.toThrow();
  });
  it('revalidates changed DNS before a subsequent delivery', async () => {
    const resolve = vi
      .fn()
      .mockResolvedValueOnce(['1.1.1.1'])
      .mockResolvedValueOnce(['169.254.169.254']);
    await destination('https://example.org/', resolve);
    await expect(destination('https://example.org/', resolve)).rejects.toThrow();
  });
  it('rejects legacy integer and hexadecimal loopback spellings', async () => {
    for (const host of ['2130706433', '0x7f000001', '127.1'])
      await expect(destination('https://' + host)).rejects.toThrow();
  });
  it('binds signature to delivery, timestamp and body; rejects stale and changed payloads', () => {
    const id = '11111111-1111-4111-8111-111111111111',
      secret = 'fixture-signing-secret',
      body = '{"answer":"fixture"}',
      now = 1800000000;
    const sig = deliverySignature(secret, id, now, body);
    expect(verifyDelivery(secret, id, String(now), sig, body, now)).toBe(true);
    expect(verifyDelivery(secret, id, String(now), sig, body, now + 301)).toBe(false);
    expect(verifyDelivery(secret, id, String(now), sig, body + ' ', now)).toBe(false);
    expect(verifyDelivery('other', id, String(now), sig, body, now)).toBe(false);
  });
  it('permits only an exact operator-pinned private callback destination',async()=>{
    const url='https://reference.invalid/callback';
    expect((await destination(url,async()=>['172.20.0.9'],{[url]:['172.20.0.9']})).address).toBe('172.20.0.9');
    await expect(destination(url,async()=>['172.20.0.10'],{[url]:['172.20.0.9']})).rejects.toThrow();
    await expect(destination(url+'?other=1',async()=>['172.20.0.9'],{[url]:['172.20.0.9']})).rejects.toThrow();
    await expect(destination(url,async()=>['169.254.169.254'],{[url]:['169.254.169.254']})).rejects.toThrow();
    await expect(destination(url,async()=>['127.0.0.1'],{[url]:['127.0.0.1']})).rejects.toThrow();
  });

});
