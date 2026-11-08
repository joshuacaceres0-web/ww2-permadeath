import { Routes, Route, Navigate } from "react-router-dom";
import Layout from "@/components/Layout";
import Home from "@/pages/Home";
import Barracks from "@/pages/Barracks";
import Memorial from "@/pages/Memorial";
import Battlefield from "@/pages/Battlefield";

// One <Route> per page in src/pages; BrowserRouter already wraps this in main.tsx.
export default function App() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route path="/" element={<Home />} />
        <Route path="/barracks" element={<Barracks />} />
        <Route path="/memorial" element={<Memorial />} />
        <Route path="/game" element={<Battlefield />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}
