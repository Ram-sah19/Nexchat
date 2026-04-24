/**
 * ToastView — displays non-blocking notification toasts.
 * DOM only — no business logic.
 */
class ToastView {
  /**
   * @param {string} message
   * @param {'info'|'error'} type
   */
  show(message, type = 'info') {
    const toast = document.createElement('div');
    toast.className   = `toast toast-${type}`;
    toast.textContent = message;
    document.body.appendChild(toast);

    // Double rAF ensures the element is painted before CSS transition fires
    requestAnimationFrame(() =>
      requestAnimationFrame(() => toast.classList.add('toast-show'))
    );

    setTimeout(() => {
      toast.classList.remove('toast-show');
      setTimeout(() => toast.remove(), 400);
    }, 3500);
  }
}
