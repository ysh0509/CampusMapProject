import { supabase } from './adminApi.js';

export async function requireAdminRole() {

  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    location.href = '../admin_login.html';
    return null;
  }

  const { data } = await supabase
    .from('admin_users')
    .select('role')
    .eq('id', user.id)
    .single();

  if (!data || data.role !== 'admin') {
    alert('권한 없음');
    location.href = '../admin_login.html';
    return null;
  }

  return user;
}