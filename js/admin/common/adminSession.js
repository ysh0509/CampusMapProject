import { supabase } from './adminApi.js';

export function initAuthListener() {
  supabase.auth.onAuthStateChange((event, session) => {

    if (!session) {
      if (!location.pathname.includes('admin_login')) {
        location.href = '/html/admin/admin_login.html';
      }
      return;
    }

  });
}