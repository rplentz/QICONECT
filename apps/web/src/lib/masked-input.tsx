export function digitsOnly(value: string) {
  return value.replace(/\D/g, "");
}

export function formatCpf(value: string) {
  return digitsOnly(value).slice(0, 11)
    .replace(/^(\d{3})(\d)/, "$1.$2")
    .replace(/^(\d{3}\.\d{3})(\d)/, "$1.$2")
    .replace(/^(\d{3}\.\d{3}\.\d{3})(\d)/, "$1-$2");
}

export function formatPhone(value: string) {
  const raw = digitsOnly(value);
  const digits = (raw.startsWith("55") && raw.length > 11 ? raw.slice(2) : raw).slice(0, 11);
  if (!digits) return "";
  if (digits.length <= 2) return `(${digits}`;
  const split = digits.length === 11 ? 7 : 6;
  const number = digits.slice(2, split);
  const suffix = digits.length > split ? `-${digits.slice(split)}` : "";
  return `(${digits.slice(0, 2)}) ${number}${suffix}`;
}

type Mask = "cpf" | "phone" | "date" | "datetime-local";

function formatDate(value: string, withTime: boolean) {
  const iso = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}))?$/.exec(value);
  if (iso) return `${iso[3]}/${iso[2]}/${iso[1]}${withTime && iso[4] ? ` ${iso[4]}:${iso[5]}` : ""}`;
  return digitsOnly(value).slice(0, withTime ? 12 : 8)
    .replace(/^(\d{2})(\d)/, "$1/$2")
    .replace(/^(\d{2}\/\d{2})(\d)/, "$1/$2")
    .replace(/^(\d{2}\/\d{2}\/\d{4})(\d)/, "$1 $2")
    .replace(/ (\d{2})(\d)/, " $1:$2");
}

function parseDate(value: string, withTime: boolean) {
  const date = /^(\d{2})\/(\d{2})\/(\d{4})(?: (\d{2}):(\d{2}))?$/.exec(value);
  if (!date || Number(date[3]) === 0 || Boolean(date[4]) !== withTime) return "";
  const iso = `${date[3]}-${date[2]}-${date[1]}`;
  const day = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(day.getTime()) || day.toISOString().slice(0, 10) !== iso) return "";
  if (!withTime) return iso;
  if (Number(date[4]) > 23 || Number(date[5]) > 59) return "";
  return `${iso}T${date[4]}:${date[5]}`;
}

type MaskedInputProps = {
  mask: Mask;
  value: string;
  onValueChange: (value: string) => void;
  required?: boolean;
  min?: string;
  max?: string;
};

export function MaskedInput({ mask, value, onValueChange, required, min, max }: MaskedInputProps) {
  const withTime = mask === "datetime-local";
  const isDate = mask === "date" || withTime;
  const format = mask === "cpf" ? formatCpf : mask === "phone" ? formatPhone : (raw: string) => formatDate(raw, withTime);
  const display = format(value);
  const iso = isDate ? parseDate(display, withTime) : "";
  let validationMessage = "";
  if (isDate && display) {
    if (!iso) validationMessage = withTime ? "Informe uma data e um horário válidos." : "Informe uma data válida.";
    else if (min && iso < min) validationMessage = `Informe uma data a partir de ${format(min)}.`;
    else if (max && iso > max) validationMessage = `Informe uma data até ${format(max)}.`;
  }
  const placeholder = { cpf: "000.000.000-00", phone: "(00) 00000-0000", date: "dd/mm/aaaa", "datetime-local": "dd/mm/aaaa hh:mm" }[mask];
  return (
    <input
      ref={(input) => { input?.setCustomValidity(validationMessage); }}
      type={mask === "phone" ? "tel" : "text"}
      inputMode={mask === "phone" ? "tel" : "numeric"}
      placeholder={placeholder}
      required={required}
      pattern={mask === "cpf" ? "[0-9]{3}\\.[0-9]{3}\\.[0-9]{3}-[0-9]{2}" : mask === "phone" ? "\\([0-9]{2}\\) [0-9]{4,5}-[0-9]{4}" : undefined}
      title={isDate ? undefined : placeholder}
      value={display}
      onChange={(event) => {
        const input = event.currentTarget;
        const formatted = format(input.value);
        const cursor = input.selectionStart ?? input.value.length;
        const digitsBeforeCursor = digitsOnly(input.value.slice(0, cursor)).length;
        let nextCursor = 0;
        if (cursor === input.value.length) {
          nextCursor = formatted.length;
        } else {
          while (nextCursor < formatted.length && digitsOnly(formatted.slice(0, nextCursor)).length < digitsBeforeCursor) nextCursor++;
        }
        input.value = formatted;
        input.setSelectionRange(nextCursor, nextCursor);
        onValueChange(isDate ? parseDate(formatted, withTime) || formatted : digitsOnly(formatted));
      }}
    />
  );
}
