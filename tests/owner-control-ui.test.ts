import { expect, it } from 'vitest';
import { originOf, safePreview } from '../src/OwnerControl';
it('allows HTTPS servers and local HTTP development, without embedded credentials',()=>{
 expect(originOf('https://engx.example.test/')).toBe('https://engx.example.test');
 expect(originOf('http://localhost:3001')).toBe('http://localhost:3001');
 expect(originOf('http://127.0.0.1:3001')).toBe('http://127.0.0.1:3001');
 expect(originOf('http://[::1]:3001')).toBe('http://[::1]:3001');
 expect(originOf('http://remote.example.test')).toBeNull();
 expect(originOf('https://person:password@engx.example.test')).toBeNull();
 expect(originOf('javascript:alert(1)')).toBeNull();
});
it('preserves ordinary record details while masking secrets and binary content',()=>{
 const result=safePreview({data:{name:'Device',password:'secret',token:'token-value',content:'data:image/png;base64,AAAA'}});
 expect(result.data.name).toBe('Device');expect(result.data.password).toBe('[مخفي]');expect(result.data.token).toBe('[مخفي]');expect(result.data.content).toBe('[محتوى مخفي]');
 expect(JSON.stringify(result)).not.toContain('token-value');
});
