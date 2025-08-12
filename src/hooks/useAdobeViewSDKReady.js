import { useEffect, useState } from "react";

export default function useAdobeViewSDKReady() {
  const [ready, setReady] = useState(!!window.AdobeDC);
  useEffect(() => {
    if (window.AdobeDC) {
      setReady(true);
      return;
    }
    const handler = () => setReady(true);
    document.addEventListener("adobe_dc_view_sdk.ready", handler);
    return () => document.removeEventListener("adobe_dc_view_sdk.ready", handler);
  }, []);
  return ready;
}
