"use client";
import { Playground } from "langgraph-kit";
import { ThemeSwitcher } from "./components/theme-switcher";


export default function Page() {
  return (
    <>
      <Playground
        suggestions={["What's the weather in Dar es Salaam?", "Take me to my orders"]}
      />
    
    </>
  );
}