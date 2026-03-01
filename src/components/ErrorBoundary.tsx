import React from 'react';
import { logger, showErrorPortal } from '~/global/logger';

interface Props {
    children: React.ReactNode;
}

interface State {
    hasError: boolean;
}

export default class ErrorBoundary extends React.Component<Props, State> {
    state: State = { hasError: false };

    static getDerivedStateFromError(): State {
        return { hasError: true };
    }

    componentDidCatch(error: Error, info: React.ErrorInfo) {
        logger.error('React render error:', error.message, error.stack);
        if (info.componentStack) {
            logger.error('Component stack:', info.componentStack);
        }
        showErrorPortal('Render Error');
        // Reset so children re-render (portal overlays the app)
        this.setState({ hasError: false });
    }

    render() {
        return this.props.children;
    }
}
