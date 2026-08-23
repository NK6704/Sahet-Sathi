import React from 'react';
import { Route, Switch, useLocation } from 'wouter';
import { AppStateProvider } from '@/state/store';
import { Header } from '@/components/Header';
import { SideNav } from '@/components/SideNav';
import { BottomNav } from '@/components/BottomNav';

// Pages
import { Landing } from '@/pages/Landing';
import { Onboarding } from '@/pages/Onboarding';
import { UserHome } from '@/pages/UserHome';
import { Assistant } from '@/pages/Assistant';
import { Schemes } from '@/pages/Schemes';
import { SchemeDetail } from '@/pages/SchemeDetail';
import { Care } from '@/pages/Care';
import { Emergency } from '@/pages/Emergency';
import { ImageAssist } from '@/pages/ImageAssist';
import { Benefits } from '@/pages/Benefits';
import { Profile } from '@/pages/Profile';
import { AshaLogin } from '@/pages/AshaLogin';
import { AshaDashboard } from '@/pages/AshaDashboard';
import { Settings } from '@/pages/Settings';

function AppLayout({ children }) {
  const [location] = useLocation();
  const isLandingOrOnboarding = location === '/' || location === '/onboarding' || location === '/asha/login';

  return (
    <div className="min-h-screen bg-[#fbf7ec] text-[#214e4a] selection:bg-[#1f655d] selection:text-[#f9f2df]">
      <Header />
      <div className="flex">
        {!isLandingOrOnboarding && <SideNav />}
        <div className="flex-1 min-w-0">{children}</div>
      </div>
      {!isLandingOrOnboarding && <BottomNav />}
    </div>
  );
}

export default function App() {
  return (
    <AppStateProvider>
      <AppLayout>
        <Switch>
          <Route path="/" component={Landing} />
          <Route path="/onboarding" component={Onboarding} />
          <Route path="/app" component={UserHome} />
          <Route path="/assistant" component={Assistant} />
          <Route path="/schemes" component={Schemes} />
          <Route path="/schemes/:id" component={SchemeDetail} />
          <Route path="/care" component={Care} />
          <Route path="/emergency" component={Emergency} />
          <Route path="/image-assist" component={ImageAssist} />
          <Route path="/benefits" component={Benefits} />
          <Route path="/profile" component={Profile} />
          <Route path="/asha/login" component={AshaLogin} />
          <Route path="/asha" component={AshaDashboard} />
          <Route path="/settings" component={Settings} />
          {/* Default fallback */}
          <Route component={UserHome} />
        </Switch>
      </AppLayout>
    </AppStateProvider>
  );
}
