export const CONSOLE_URL = import.meta.env.VITE_CONSOLE_URL ?? "http://localhost:5173";
export const CONSOLE_IS_DEFAULT = !import.meta.env.VITE_CONSOLE_URL;
export const WRAPPER_DEMO_URL = import.meta.env.VITE_WRAPPER_DEMO_URL ?? "http://localhost:8000/widget-demo";
export const WRAPPER_DEMO_IS_DEFAULT = !import.meta.env.VITE_WRAPPER_DEMO_URL;
