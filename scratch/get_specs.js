import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config({ path: './.env.local' });
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SECRET_KEY);
(async () => {
  const { data } = await supabase.from('ref_specialities').select('code, name');
  console.log(data.length);
  console.log(JSON.stringify(data.map(d => `${d.name} (${d.code})`)));
})();
