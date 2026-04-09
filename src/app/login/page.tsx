'use client';
import React from 'react';
import LoginForm from '../../components/LoginForm';

export default function LoginPage() {
  const handleSuccess = () => {
    window.location.href = '/labs';
  };
  return (
    <div style={{ minHeight: '100vh', background: '#11111b' }}>
      <LoginForm onSuccess={handleSuccess} />
    </div>
  );
}
