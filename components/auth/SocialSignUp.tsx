import React from 'react';
import GoogleButton from './GoogleButton';

// The sign up modal's social options. Only Google, and only when Google is
// actually enabled on this project — see lib/authProviders. The "-- or --"
// line is handed to the button so that it disappears along with it.
const SocialSignUp = () => (
    <GoogleButton
        divider={<h1 className="text-center font-bold text-xl my-2">-- or --</h1>}
    />
);

export default SocialSignUp;
