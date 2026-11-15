for (const input of document.querySelectorAll('#loginForm input[type="password"], #registerForm input[type="password"], form[action="/reset-password"] input[type="password"]')) {
  const container = document.createElement('span');
  container.className = 'relative block';
  input.before(container);
  container.append(input);
  input.style.paddingInlineEnd = '3rem';
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'absolute inset-y-0 right-0 flex w-11 items-center justify-center rounded-xl text-slate-500 hover:text-emerald-800 focus-visible:outline-emerald-800';
  const field = input.name === 'confirmPassword' ? 'confirmation password' : 'password';
  const draw = (visible) => {
    button.setAttribute('aria-label', `${visible ? 'Hide' : 'Show'} ${field}`);
    button.innerHTML = `<svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" aria-hidden="true">
      <path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/>
      ${visible ? '<path d="m3 3 18 18"/>' : ''}</svg>`;
  };
  draw(false);
  button.addEventListener('click', event => {
    event.preventDefault();
    const visible = input.type === 'password';
    input.type = visible ? 'text' : 'password';
    draw(visible);
  });
  container.append(button);
}
