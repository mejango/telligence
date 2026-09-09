"use client";

import {
  createContext,
  createElement,
  FormEvent,
  InputHTMLAttributes,
  ReactNode,
  TextareaHTMLAttributes,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

type AnyRecord = Record<string, unknown>;
type PathSegment = string | number;

export type FormErrors<Values> = Values extends readonly (infer Item)[]
  ? Array<FormErrors<Item> | string | undefined> | string
  : Values extends object
    ? { [Key in keyof Values]?: FormErrors<Values[Key]> | string } & { _form?: string }
    : string;

export type FormTouched<Values> = Values extends readonly (infer Item)[]
  ? Array<FormTouched<Item> | boolean | undefined> | boolean
  : Values extends object
    ? { [Key in keyof Values]?: FormTouched<Values[Key]> | boolean }
    : boolean;

export type FormValidate<Values> = (values: Values) => FormErrors<Values>;

export interface FormHelpers<Values> {
  resetForm: (nextValues?: Values) => void;
  setFieldValue: (field: string, value: unknown) => void;
  setSubmitting: (submitting: boolean) => void;
  setValues: (values: Values | ((previous: Values) => Values)) => void;
}

export interface FormContextValue<Values> extends FormHelpers<Values> {
  errors: FormErrors<Values>;
  handleSubmit: (event?: FormEvent<HTMLFormElement>) => Promise<void>;
  isSubmitting: boolean;
  isValid: boolean;
  setFieldTouched: (field: string, touched?: unknown) => void;
  submitCount: number;
  submitForm: () => Promise<void>;
  touched: FormTouched<Values>;
  values: Values;
}

interface FormProviderProps<Values> {
  children: ReactNode | ((context: FormContextValue<Values>) => ReactNode);
  enableReinitialize?: boolean;
  initialValues: Values;
  isInitialValid?: boolean;
  onSubmit: (values: Values, helpers: FormHelpers<Values>) => void | Promise<void>;
  validate?: FormValidate<Values>;
}

interface FieldMeta {
  error?: string;
  touched: boolean;
  value: unknown;
}

interface FieldHelpers {
  setTouched: (touched?: boolean) => void;
  setValue: (value: unknown) => void;
}

export type FieldAttributes<Value = unknown> = Omit<InputHTMLAttributes<HTMLInputElement>, "name"> &
  Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, "name" | "onChange" | "onBlur"> & {
    as?: "input" | "textarea";
    component?: "input" | "textarea";
    name: string;
    prefix?: ReactNode;
    suffix?: ReactNode;
    value?: Value;
  };

const FormContext = createContext<FormContextValue<unknown> | null>(null);

function pathSegments(path: string): PathSegment[] {
  return path
    .replace(/\[(\d+)\]/g, ".$1")
    .split(".")
    .filter(Boolean)
    .map((segment) => (/^\d+$/.test(segment) ? Number(segment) : segment));
}

export function getFormValue(root: unknown, path: string): unknown {
  let cursor = root;
  for (const segment of pathSegments(path)) {
    if (cursor === null || cursor === undefined || typeof cursor !== "object") return undefined;
    cursor = (cursor as AnyRecord)[String(segment)];
  }
  return cursor;
}

function containerFor(nextSegment: PathSegment): AnyRecord | unknown[] {
  return typeof nextSegment === "number" ? [] : {};
}

function cloneValue<Value>(value: Value): Value {
  if (Array.isArray(value)) return value.map(cloneValue) as Value;
  if (value instanceof Date) return new Date(value.getTime()) as Value;
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, child]) => [key, cloneValue(child)]),
    ) as Value;
  }
  return value;
}

export function setFormValue<Values>(root: Values, path: string, value: unknown): Values {
  const segments = pathSegments(path);
  if (segments.length === 0) return value as Values;

  const update = (current: unknown, index: number): unknown => {
    if (index === segments.length) return value;

    const segment = segments[index];
    const source =
      current !== null && typeof current === "object" ? current : containerFor(segment);
    const clone = Array.isArray(source) ? [...source] : { ...(source as AnyRecord) };
    (clone as AnyRecord)[String(segment)] = update(
      (source as AnyRecord)[String(segment)],
      index + 1,
    );
    return clone;
  };

  return update(root, 0) as Values;
}

export function hasErrors(value: unknown): boolean {
  if (typeof value === "string") return value.length > 0;
  if (Array.isArray(value)) return value.some(hasErrors);
  if (value && typeof value === "object") return Object.values(value).some(hasErrors);
  return false;
}

function equalValues(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true;
  if (typeof left !== typeof right || left === null || right === null) return false;
  if (Array.isArray(left)) {
    return (
      Array.isArray(right) &&
      left.length === right.length &&
      left.every((item, index) => equalValues(item, right[index]))
    );
  }
  if (typeof left === "object") {
    const leftKeys = Object.keys(left);
    const rightKeys = Object.keys(right as object);
    return (
      leftKeys.length === rightKeys.length &&
      leftKeys.every(
        (key) =>
          Object.prototype.hasOwnProperty.call(right, key) &&
          equalValues((left as AnyRecord)[key], (right as AnyRecord)[key]),
      )
    );
  }
  return false;
}

export function FormProvider<Values>({
  children,
  enableReinitialize = false,
  initialValues,
  isInitialValid,
  onSubmit,
  validate,
}: FormProviderProps<Values>) {
  const initialValuesRef = useRef(cloneValue(initialValues));
  const [values, setValuesState] = useState(() => cloneValue(initialValues));
  const [touched, setTouchedState] = useState<FormTouched<Values>>({} as FormTouched<Values>);
  const [isSubmitting, setSubmitting] = useState(false);
  const [submitCount, setSubmitCount] = useState(0);
  const submissionInFlightRef = useRef(false);

  useEffect(() => {
    if (!enableReinitialize || equalValues(initialValuesRef.current, initialValues)) return;
    initialValuesRef.current = cloneValue(initialValues);
    setValuesState(cloneValue(initialValues));
    setTouchedState({} as FormTouched<Values>);
    setSubmitCount(0);
    setSubmitting(false);
  }, [enableReinitialize, initialValues]);

  const errors = useMemo(
    () => validate?.(values) ?? ({} as FormErrors<Values>),
    [validate, values],
  );
  const dirty = !equalValues(initialValuesRef.current, values);
  const isValid = !hasErrors(errors) && (dirty || submitCount > 0 || isInitialValid !== false);

  const setFieldValue = useCallback((field: string, value: unknown) => {
    setValuesState((previous) => {
      if (Object.is(getFormValue(previous, field), value)) return previous;
      return setFormValue(previous, field, value);
    });
  }, []);

  const setValues = useCallback((next: Values | ((previous: Values) => Values)) => {
    setValuesState((previous) =>
      typeof next === "function" ? (next as (previous: Values) => Values)(previous) : next,
    );
  }, []);

  const setFieldTouched = useCallback((field: string, nextTouched: unknown = true) => {
    setTouchedState((previous) => {
      if (Object.is(getFormValue(previous, field), nextTouched)) return previous;
      return setFormValue(previous, field, nextTouched);
    });
  }, []);

  const resetForm = useCallback((nextValues?: Values) => {
    const resetValues = cloneValue(nextValues ?? initialValuesRef.current);
    initialValuesRef.current = cloneValue(resetValues);
    setValuesState(resetValues);
    setTouchedState({} as FormTouched<Values>);
    setSubmitCount(0);
    setSubmitting(false);
  }, []);

  const helpers = useMemo<FormHelpers<Values>>(
    () => ({ resetForm, setFieldValue, setSubmitting, setValues }),
    [resetForm, setFieldValue, setValues],
  );

  const submitForm = useCallback(async () => {
    // React state does not update synchronously. Guard with a ref as well so a
    // rapid double click cannot start two quotes or wallet transactions.
    if (submissionInFlightRef.current) return;

    setSubmitCount((count) => count + 1);
    const currentErrors = validate?.(values) ?? ({} as FormErrors<Values>);
    if (hasErrors(currentErrors)) return;

    submissionInFlightRef.current = true;
    setSubmitting(true);
    try {
      await onSubmit(values, helpers);
    } finally {
      submissionInFlightRef.current = false;
      setSubmitting(false);
    }
  }, [helpers, onSubmit, validate, values]);

  const handleSubmit = useCallback(
    async (event?: FormEvent<HTMLFormElement>) => {
      event?.preventDefault();
      event?.stopPropagation();
      await submitForm();
    },
    [submitForm],
  );

  const context = useMemo<FormContextValue<Values>>(
    () => ({
      errors,
      handleSubmit,
      isSubmitting,
      isValid,
      resetForm,
      setFieldTouched,
      setFieldValue,
      setSubmitting,
      setValues,
      submitCount,
      submitForm,
      touched,
      values,
    }),
    [
      errors,
      handleSubmit,
      isSubmitting,
      isValid,
      resetForm,
      setFieldTouched,
      setFieldValue,
      setValues,
      submitCount,
      submitForm,
      touched,
      values,
    ],
  );

  return (
    <FormContext.Provider value={context as FormContextValue<unknown>}>
      {typeof children === "function" ? children(context) : children}
    </FormContext.Provider>
  );
}

export function useFormContext<Values = AnyRecord>(): FormContextValue<Values> {
  const context = useContext(FormContext);
  if (!context) throw new Error("Form fields must be rendered inside a FormProvider");
  return context as FormContextValue<Values>;
}

export function useField<Value = unknown>(
  props: string | Pick<FieldAttributes<Value>, "name">,
): [
  {
    name: string;
    onBlur: () => void;
    onChange: (event: { target: { checked?: boolean; type?: string; value: unknown } }) => void;
    value: unknown;
  },
  FieldMeta,
  FieldHelpers,
] {
  const name = typeof props === "string" ? props : props.name;
  const { errors, setFieldTouched, setFieldValue, touched, values } = useFormContext();
  const value = getFormValue(values, name);
  const error = getFormValue(errors, name);
  const wasTouched = getFormValue(touched, name);

  const setValue = useCallback(
    (nextValue: unknown) => setFieldValue(name, nextValue),
    [name, setFieldValue],
  );
  const setTouched = useCallback(
    (nextTouched = true) => setFieldTouched(name, nextTouched),
    [name, setFieldTouched],
  );

  return [
    {
      name,
      onBlur: setTouched,
      onChange: (event) =>
        setValue(
          event.target.type === "checkbox" ? Boolean(event.target.checked) : event.target.value,
        ),
      value,
    },
    {
      error: typeof error === "string" ? error : undefined,
      touched: wasTouched === true,
      value,
    },
    { setTouched, setValue },
  ];
}

export function FormField<Value = unknown>({
  as,
  component,
  name,
  onBlur,
  onChange,
  prefix: _prefix,
  suffix: _suffix,
  type,
  value: explicitValue,
  ...props
}: FieldAttributes<Value>) {
  const { setFieldTouched, setFieldValue, values } = useFormContext();
  const currentValue = getFormValue(values, name);
  const element = component ?? as ?? "input";
  const isCheckbox = type === "checkbox";
  const isRadio = type === "radio";
  const hasExplicitValue = explicitValue !== undefined;

  const fieldProps: Record<string, unknown> = {
    ...props,
    name,
    onBlur: (event: React.FocusEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      setFieldTouched(name, true);
      onBlur?.(event as React.FocusEvent<HTMLInputElement>);
    },
    onChange: (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      if (onChange) {
        onChange(event as React.ChangeEvent<HTMLInputElement>);
        return;
      }

      if (isCheckbox) {
        const input = event.currentTarget as HTMLInputElement;
        if (hasExplicitValue && Array.isArray(currentValue)) {
          const next = input.checked
            ? [...currentValue, explicitValue]
            : currentValue.filter((item) => !Object.is(item, explicitValue));
          setFieldValue(name, next);
        } else {
          setFieldValue(name, input.checked);
        }
        return;
      }

      setFieldValue(name, event.currentTarget.value);
    },
    type,
  };

  if (isCheckbox) {
    fieldProps.value = explicitValue;
    fieldProps.checked =
      props.checked ??
      (hasExplicitValue && Array.isArray(currentValue)
        ? currentValue.some((item) => Object.is(item, explicitValue))
        : Boolean(currentValue));
  } else if (isRadio) {
    fieldProps.value = explicitValue;
    fieldProps.checked = props.checked ?? Object.is(currentValue, explicitValue);
  } else {
    fieldProps.value = explicitValue ?? (currentValue as string | number | readonly string[]) ?? "";
  }

  return createElement(element, fieldProps);
}

export function Form(props: React.FormHTMLAttributes<HTMLFormElement>) {
  const { handleSubmit } = useFormContext();
  return <form {...props} onSubmit={handleSubmit} />;
}

interface ArrayHelpers<Item> {
  push: (value: Item) => void;
  remove: (index: number) => Item | undefined;
  replace: (index: number, value: Item) => void;
}

export function FieldArray<Item = unknown>({
  children,
  name,
  render,
}: {
  children?: (helpers: ArrayHelpers<Item>) => ReactNode;
  name: string;
  render?: (helpers: ArrayHelpers<Item>) => ReactNode;
}) {
  const { setFieldTouched, setFieldValue, touched, values } = useFormContext();
  const current = getFormValue(values, name);
  const items = useMemo(() => (Array.isArray(current) ? (current as Item[]) : []), [current]);

  const helpers = useMemo<ArrayHelpers<Item>>(
    () => ({
      push: (value) => setFieldValue(name, [...items, value]),
      remove: (index) => {
        const removed = items[index];
        const next = [...items];
        next.splice(index, 1);
        setFieldValue(name, next);

        const currentTouched = getFormValue(touched, name);
        if (Array.isArray(currentTouched)) {
          const nextTouched = [...currentTouched];
          nextTouched.splice(index, 1);
          setFieldTouched(name, nextTouched);
        }
        return removed;
      },
      replace: (index, value) => {
        const next = [...items];
        next[index] = value;
        setFieldValue(name, next);
      },
    }),
    [items, name, setFieldTouched, setFieldValue, touched],
  );

  return <>{render?.(helpers) ?? children?.(helpers) ?? null}</>;
}
