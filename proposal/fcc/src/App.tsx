import Nav from '@/sections/Nav';
import Hero from '@/sections/Hero';
import Architecture from '@/sections/Architecture';
import Stack from '@/sections/Stack';
import DashboardSection from '@/sections/DashboardSection';
import DesignSystemSection from '@/sections/DesignSystemSection';
import Footer from '@/sections/Footer';

export default function App() {
  return (
    <div className="relative min-h-screen bg-ink-950 text-bone">
      <Nav />
      <main>
        <Hero />
        <Architecture />
        <Stack />
        <DashboardSection />
        <DesignSystemSection />
      </main>
      <Footer />
    </div>
  );
}
