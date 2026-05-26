import { supabase } from './common/adminApi.js';

async function signup() {
  const email = document.getElementById('email').value;
  const password = document.getElementById('password').value;

  // 1. auth 회원가입
  const { data, error } = await supabase.auth.signUp({
    email,
    password
  });

  console.log('signup result:', data);
  console.log(error);

  if (error) {
    alert('회원가입 실패');
    return;
  }

  // user 존재 확인
  const user = data.user;

  if (!user) {
    alert('유저 정보 생성 실패');
    return;
  }

  // 2. admin_users 추가
  const { error: insertError } = await supabase
    .from('admin_users')
    .insert({
      id: user.id,
      email: user.email,
      role: 'admin'
    });

  console.log(insertError);

  if (insertError) {
    alert('admin_users 저장 실패');
    return;
  }

  alert('회원가입 완료');
  location.href = 'admin_login.html';
}

document.getElementById('signup-btn').onclick = signup;