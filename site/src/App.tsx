import { useEffect, useState } from "react";
import { Booking } from "@/pages/Booking";
import { CustomerTour } from "@/pages/CustomerTour";
import { DemoConsole } from "@/pages/demo/DemoConsole";
import { Landing } from "@/pages/Landing";
import { VoiceDemo } from "@/pages/VoiceDemo";

const TITLES: Record<string, string> = {
  "/": "Vela Agent Platform — localised, omnichannel AI agents",
  "/demo": "Product tour · Vela Agent Platform",
  "/customer": "Customer tour · Vela Agent Platform",
  "/voice": "MNO voice line · Vela Agent Platform",
  "/book": "Book a paid consultation · Vela Agent Platform",
};

export default function App() {
  const [path, setPath] = useState(() => window.location.pathname.replace(/\/+$/, "") || "/");

  useEffect(() => {
    const onPop = () => setPath(window.location.pathname.replace(/\/+$/, "") || "/");
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  useEffect(() => {
    document.title = TITLES[path] ?? TITLES["/"];
  }, [path]);

  if (path === "/demo") return <DemoConsole />;
  if (path === "/customer") return <CustomerTour />;
  if (path === "/voice") return <VoiceDemo />;
  if (path === "/book") return <Booking />;
  return <Landing />;
}
