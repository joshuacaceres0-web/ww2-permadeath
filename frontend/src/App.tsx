import { Routes, Route, Navigate } from "react-router-dom";
import Layout from "@/components/Layout";
import Home from "@/pages/Home";
import Barracks from "@/pages/Barracks";
import Memorial from "@/pages/Memorial";
import Battlefield from "@/pages/Battlefield";
import StartMenu from "@/pages/StartMenu";
import HowToPlay from "@/pages/HowToPlay";

// One <Route> per page in src/pages; BrowserRouter already wraps this in main.tsx.
export default function App() {
  return (
    <Routes>
      <Route path="/" element={<StartMenu />} />
      <Route path="/how-to-play" element={<HowToPlay />} />
      <Route element={<Layout />}>
        <Route path="/war-room" element={<Home />} />
        <Route path="/barracks" element={<Barracks />} />
        <Route path="/memorial" element={<Memorial />} />
        <Route path="/game" element={<Battlefield />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}
