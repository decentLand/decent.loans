/*

PST pairs registry for decent.loans platform.

- REQUIREMENT:
	-- the PST must be compatible with the FCP protocol
	-- only the contract deployer can create a new pair
	-- pairs duplicationis  disallowed

- CONTRIBUTOR(s):
	-- charmful0x



*/



export async function handle(state, action) {
	const caller = action.caller
	const input = action.input
	// SWC's state
	const pairs = state.pairs
	// Errors constants
	const ERROR_PAIR_ALREADY_EXIST = `The provided pair already exists in the tokens list`;
	const ERROR_INVALID_ARWEAVE_ADDRESS = `The provided string is not a valide Arweave address`;
	const ERROR_MISSING_FCP_NOT_SUPPORTED = `the provided token SWC does not support FCP protocol`;

	if (input.function === "createPair") {
		const pair_token_one = input.tokenOne
		const pair_token_two = input.tokenTwo

		_validateTokenContract(pair_token_one);
		_validateTokenContract(pair_token_two);
		_checkPairDuplication(pair_token_one, pair_token_two);

		pairs.push( [pair_token_one, pair_token_two] )

		return { state }
	}

	
	
	// HELPER FUNCTIONS
	function _len(string) {
		return string.length
	}

	function _validateTokenContract(address) {
		if (_len(address) !== 43) {
			throw new ContractError(ERROR_INVALID_ARWEAVE_ADDRESS)
		}

		if (typeof address !== "string") {
			throw new ContractError(ERROR_INVALID_ARWEAVE_ADDRESS)
		}

		const tokenState = await SmartWeave.contracts.readContractState(address)

		if(! tokenState.foreignCalls) {
			throw new ContractError(ERROR_MISSING_FCP_NOT_SUPPORTED)
		}
	}

	function _checkPairDuplication(tokenOne, tokenTwo) {
		const existence = pairs.find( (pair) => ( pair.includes(tokenOne) && pair.includes(tokenTwo) ) )

		if (existence !== undefined) {
			throw new ContractError(ERROR_PAIR_ALREADY_EXIST)
		}
	}
}

