const DIGITS = '零壹贰叁肆伍陆柒捌玖';
const UNITS = ['', '拾', '佰', '仟'];
const SECTIONS = ['', '万', '亿', '兆'];

/** 四位以内的一节：中间的零只写一个，末尾的零不写 */
function section(digits: string): string {
  let out = '';
  let zero = false;
  const list = digits.padStart(4, '0').split('');
  list.forEach((ch, i) => {
    const d = Number(ch);
    if (d === 0) {
      zero = out !== '';
      return;
    }
    if (zero) out += '零';
    zero = false;
    out += DIGITS[d] + UNITS[3 - i];
  });
  return out;
}

/**
 * 人民币大写金额（合同打印，M14 §5；中文法定写法，不随界面语言变化）：只做字符串处理，不经过浮点数。
 * '77000.00' → '柒万柒仟元整'，'1005.07' → '壹仟零伍元零柒分'，'0.05' → '伍分'
 */
export function amountInChinese(value: string): string {
  const [intRaw, fracRaw = ''] = value.trim().replace(/^-/, '').split('.');
  const intDigits = intRaw.replace(/^0+/, '');
  const [jiao, fen] = (fracRaw + '00').slice(0, 2).split('').map(Number);

  let integer = '';
  if (intDigits) {
    const groups: string[] = [];
    for (let end = intDigits.length; end > 0; end -= 4) groups.unshift(intDigits.slice(Math.max(0, end - 4), end));
    let pendingZero = false;
    groups.forEach((g, i) => {
      const unit = SECTIONS[groups.length - 1 - i];
      if (Number(g) === 0) {
        pendingZero = integer !== '';
        return;
      }
      // 上一节是 0，或这一节不足千位（如 10,0010 的"零壹拾"）时补一个零
      if (integer && (pendingZero || g.padStart(4, '0')[0] === '0')) integer += '零';
      pendingZero = false;
      integer += section(g) + unit;
    });
    integer += '元';
  }

  if (jiao === 0 && fen === 0) return `${integer || '零元'}整`;
  let fraction = '';
  if (jiao > 0) fraction += `${DIGITS[jiao]}角`;
  else if (integer) fraction += '零';
  if (fen > 0) fraction += `${DIGITS[fen]}分`;
  return integer + fraction;
}
