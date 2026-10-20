import { it, expect } from 'vitest';
import { parseAction } from '../src/agentActions';
it('accepts the documented Arabic add-device command without changing its name',()=>{
 expect(parseAction('أضف جهاز: جهاز مساعد تجريبي | كود: DEMO-AI-001')).toEqual({action:'create_device',args:{name:'جهاز مساعد تجريبي',asset_code:'DEMO-AI-001'}});
});
