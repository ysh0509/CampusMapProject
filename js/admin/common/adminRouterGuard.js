import { supabase } from './adminApi.js';

const LOGIN_PATH = '/html/admin/admin_login.html';

export async function protectPage() {
  try {
    const { data: sessionData, error: sessionErr } = await supabase.auth.getSession();
    if (sessionErr) throw sessionErr;

    const user = sessionData?.session?.user;
    if (!user) {
      location.href = LOGIN_PATH;
      return null;
    }

    const { data: roleData, error: roleErr } = await supabase
      .from('admin_users')
      .select('role')
      .eq('id', user.id)
      .single();

    const role = roleData?.role;
    const allowed = role === 'admin' || role === 'superadmin';

    if (roleErr || !roleData || !allowed) {
      location.href = LOGIN_PATH;
      return null;
    }

    return user;
  } catch (e) {
    console.error('protectPage error', e);
    location.href = LOGIN_PATH;
    return null;
  }
}
