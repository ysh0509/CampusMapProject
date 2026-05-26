import { supabase } from './common/adminApi.js';

const loginBtn = document.getElementById('login-btn');
const forgotBtn = document.getElementById('forgot-password-btn');
const errorMsg = document.getElementById('login-error');

// 1. 로그인 기능
async function login() {
  const email = document.getElementById('email').value;
  const password = document.getElementById('password').value;
  errorMsg.style.display = 'none';

  const { error } = await supabase.auth.signInWithPassword({ email, password });

  if (error) {
    errorMsg.style.display = 'block';
    return;
  }

  location.href = 'admin_dashboard.html';
}

// 2. 비밀번호 재설정 기능 (이메일 발송)
async function resetPassword() {
  const email = document.getElementById('email').value;
  if (!email) {
    alert('재설정할 이메일 주소를 입력해주세요.');
    return;
  }

  const { error } = await supabase.auth.resetPasswordForEmail(email);

  if (error) {
    alert('이메일 발송 실패: ' + error.message);
    return;
  }

  alert('비밀번호 재설정 링크가 이메일로 전송되었습니다. 이메일을 확인해주세요.');
}

loginBtn.onclick = login;
forgotBtn.onclick = (e) => {
  e.preventDefault();
  resetPassword();
};
