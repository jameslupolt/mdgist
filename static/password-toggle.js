document.addEventListener('change', (event) => {
  const target = event.target;
  if (!(target instanceof HTMLInputElement)) return;
  if (target.type !== 'checkbox') return;

  const inputId = target.dataset.togglePassword;
  if (!inputId) return;

  const passwordInput = document.getElementById(inputId);
  if (!(passwordInput instanceof HTMLInputElement)) return;

  passwordInput.type = target.checked ? 'text' : 'password';
});
