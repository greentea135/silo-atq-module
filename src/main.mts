import fetch from "node-fetch";
import { ContractTag, ITagService } from "atq-types";

// Define the subgraph URLs
const SUBGRAPH_URLS: Record<string, { decentralized: string }> = {
  // Ethereum Mainnet subgraph, by silograph.eth (0x6d64874a768607ed847fb7dd6f522b3dc52024bc)
  "1": {
    decentralized:
      "https://gateway.thegraph.com/api/[api-key]/subgraphs/id/GTEyHhRmhRRJkQfrDWsapcZ8sBKAka4GFej6gn3BpJNq",
  },
  // Optimism subgraph, by silograph.eth (0x6d64874a768607ed847fb7dd6f522b3dc52024bc)
  "10": {
    decentralized:
      "https://gateway.thegraph.com/api/[api-key]/subgraphs/id/HVhUwbDrY5uGyz5u3bvKQVfmagVet3Uwy7jWjFrvT6s6",
  },
  // Base subgraph, by silograph.eth (0x6d64874a768607ed847fb7dd6f522b3dc52024bc)
  "8453": {
    decentralized:
      "https://gateway.thegraph.com/api/[api-key]/subgraphs/id/HzQEXpsJuq7XQa4zXEJU38aUnG7mgZ6gA74HauHyYZzQ",
  },
  // Arbitrum subgraph, by silograph.eth (0x6d64874a768607ed847fb7dd6f522b3dc52024bc)
  "42161": {
    decentralized:
      "https://gateway.thegraph.com/api/[api-key]/subgraphs/id/2ufoztRpybsgogPVW6j9NTn1JmBWFYPKbP7pAabizADU",
  },
};

// Define the Silo interface
interface Silo {
  id: string;
  name: string;
  createdTimestamp: number;
}

// Define the GraphQL response structure
interface GraphQLData {
  silos: Silo[];
}

interface GraphQLResponse {
  data?: GraphQLData;
  errors?: { message: string }[]; // Assuming the API might return errors in this format
}

// Define headers for the query
const headers: Record<string, string> = {
  "Content-Type": "application/json",
  Accept: "application/json",
};

// Define the GraphQL query
const GET_SILOS_QUERY = `
query GetSilos($lastTimestamp: Int) {
  silos(
    first: 1000,
    orderBy: createdTimestamp,
    orderDirection: asc,
    where: { createdTimestamp_gt: $lastTimestamp }
  ) {
    id
    name
    createdTimestamp
  }
}
`;

// Type guard for errors
function isError(e: unknown): e is Error {
  return (
    typeof e === "object" &&
    e !== null &&
    "message" in e &&
    typeof (e as Error).message === "string"
  );
}

// Function to check for invalid values
function containsInvalidValue(text: string): boolean {
  const containsHtml = /<[^>]*>/.test(text);
  const isEmpty = text.trim() === "";
  return isEmpty || containsHtml;
}

// Function to truncate strings
function truncateString(text: string, maxLength: number) {
  if (text.length > maxLength) {
    return text.substring(0, maxLength - 3) + "..."; // Subtract 3 for the ellipsis
  }
  return text;
}

// Function to fetch data from the GraphQL endpoint
async function fetchData(
  subgraphUrl: string,
  lastTimestamp: number
): Promise<Silo[]> {
  const response = await fetch(subgraphUrl, {
    method: "POST",
    headers,
    body: JSON.stringify({
      query: GET_SILOS_QUERY,
      variables: { lastTimestamp },
    }),
  });

  if (!response.ok) {
    throw new Error(`HTTP error: ${response.status}`);
  }

  const result = (await response.json()) as GraphQLResponse;
  if (result.errors) {
    result.errors.forEach((error) => {
      console.error(`GraphQL error: ${error.message}`);
    });
    throw new Error("GraphQL errors occurred: see logs for details.");
  }

  if (!result.data || !result.data.silos) {
    throw new Error("No silos data found.");
  }

  return result.data.silos;
}

// Function to prepare the URL with the provided API key
function prepareUrl(chainId: string, apiKey: string): string {
  const urls = SUBGRAPH_URLS[chainId];
  if (!urls || isNaN(Number(chainId))) {
    const supportedChainIds = Object.keys(SUBGRAPH_URLS).join(", ");
    throw new Error(
      `Unsupported or invalid Chain ID provided: ${chainId}. Only the following values are accepted: ${supportedChainIds}`
    );
  }
  return urls.decentralized.replace("[api-key]", encodeURIComponent(apiKey));
}

// Function to transform silo data into ContractTag objects
function transformSilosToTags(chainId: string, silos: Silo[]): ContractTag[] {
  const validSilos: Silo[] = [];
  const rejectedNames: string[] = [];

  silos.forEach((silo) => {
    const nameInvalid = containsInvalidValue(silo.name);

    if (nameInvalid) {
      rejectedNames.push(`Silo: ${silo.id} rejected due to invalid name - Name: ${silo.name}`);
    } else {
      validSilos.push(silo);
    }
  });

  if (rejectedNames.length > 0) {
    console.log("Rejected silos:", rejectedNames);
  }

  return validSilos.map((silo) => {
    const maxNameLength = 45;
    const truncatedNameText = truncateString(silo.name, maxNameLength);

    return {
      "Contract Address": `eip155:${chainId}:${silo.id}`,
      "Public Name Tag": `${truncatedNameText} Silo`,
      "Project Name": "Silo v1",
      "UI/Website Link": "https://app.silo.finance/",
      "Public Note": `Silo v1's official ${silo.name} Silo contract.`,
    };
  });
}

// The main logic for this module
class TagService implements ITagService {
  returnTags = async (
    chainId: string,
    apiKey: string
  ): Promise<ContractTag[]> => {
    let allTags: ContractTag[] = [];
    let lastTimestamp: number = 0;
    let isMore = true;

    const url = prepareUrl(chainId, apiKey);

    while (isMore) {
      try {
        const silos = await fetchData(url, lastTimestamp);
        const tags = transformSilosToTags(chainId, silos);
        allTags.push(...tags);

        isMore = silos.length === 1000; // Continue if we fetched 1000 records
        if (isMore) {
          lastTimestamp = Math.max(...silos.map(s => s.createdTimestamp));
        }
      } catch (error) {
        if (isError(error)) {
          console.error(`An error occurred: ${error.message}`);
          throw new Error(`Failed fetching data: ${error}`); // Propagate a new error with more context
        } else {
          console.error("An unknown error occurred.");
          throw new Error("An unknown error occurred during fetch operation."); // Throw with a generic error message if the error type is unknown
        }
      }
    }
    return allTags;
  };
}

// Creating an instance of TagService
const tagService = new TagService();

// Exporting the returnTags method directly
export const returnTags = tagService.returnTags;

