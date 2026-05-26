import { supabase } from './common/adminApi.js';

async function login() {
  const email = document.getElementById('email').value;
  const password = document.getElementById('password').value;

  const { data, error } = await supabase.auth.signInWithPassword({
    email,
    password
  });

  if (error) {
    alert('로그인 실패');
    return;
  }

  location.href = 'admin_dashboard.html';
}

document.getElementById('login-btn').onclick = login;