/**
 * 读取当前页面域下可被JavaScript访问的Cookie。
 * 若客户平台将Access-Token设置为HttpOnly，应改用客户公共请求层，而不是尝试在前端读取。
 */
export function getCookie(name: string): string | null {
  const encodedName = encodeURIComponent(name);
  const cookies = document.cookie ? document.cookie.split('; ') : [];

  for (const cookie of cookies) {
    const separatorIndex = cookie.indexOf('=');
    const key = separatorIndex >= 0 ? cookie.slice(0, separatorIndex) : cookie;
    if (key !== encodedName && decodeURIComponent(key) !== name) continue;
    const value = separatorIndex >= 0 ? cookie.slice(separatorIndex + 1) : '';
    return decodeURIComponent(value);
  }

  return null;
}
